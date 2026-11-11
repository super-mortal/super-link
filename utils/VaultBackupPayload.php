<?php

namespace Utils;

use Framework\Exceptions\ValidationException;

/**
 * 加密备份文件（.slvault）的解析与校验（PRD §8.1）。
 *
 * 为什么单独一个类：导出端 `VaultExportController` 写文件、导入端 `VaultImportController`
 * 读文件，两边的结构约定（顶层 KDF 元信息 + accounts[] + 每条账号的 authorizations[]）
 * 必须逐字段对齐；散落在两个控制器里，改一个字段就会漏改另一处，导入时才会以
 * 「无法解密」的形式爆出来。集中在这里，导出按它组装、导入按它校验。
 *
 * 安全边界：这里只校验「结构」，不校验密文内容——服务端没有 DEK，判断不了密文对错。
 * 主密码与密文的有效性由前端在导入前用 GCM 校验（见 frontend lib/vaultBackup.ts）。
 */
class VaultBackupPayload
{
	/**
	 * 解析并校验备份文件，返回：
	 * [
	 *   'meta' => VaultMetaPayload::parse() 同款字段（密文已解码为二进制，可直接写 vault_meta），
	 *   'accounts' => [ 账号字段（含 *_ct / *_iv 密文列）+ authorizations[] ],
	 * ]
	 *
	 * @throws ValidationException 结构非法时抛出，message 为普通中文
	 */
	public static function parse(array $input): array
	{
		// 版本号必须显式存在且已知：未来的 v2 文件会有 v1 不认识的字段，
		// 按 v1 硬解析会把新字段静默丢弃、写坏数据，所以高版本直接拒绝
		$version = $input['version'] ?? null;
		if (!self::isPositiveInt($version)) {
			throw new ValidationException('备份文件格式不正确：缺少加密格式版本', 400);
		}
		if ((int)$version > VaultMetaPayload::DEFAULT_VERSION) {
			throw new ValidationException('不支持的备份文件版本，请升级应用后再导入', 400);
		}

		// KDF 元信息与 setup / change-master 的入参完全同构（同一套键名与 base64 规则），
		// 直接复用 VaultMetaPayload::parse()，避免两套校验漂移
		$meta = VaultMetaPayload::parse($input);

		$accounts = $input['accounts'] ?? null;
		if (!is_array($accounts)) {
			throw new ValidationException('备份文件格式不正确：accounts 必须为数组', 400);
		}

		$parsed_accounts = [];
		$seen_ids = [];
		$seen_authorization_ids = [];

		foreach ($accounts as $account) {
			$parsed = self::parseAccount($account);

			// 文件内部 id 必须唯一：导入的冲突判断（merge 按 id 跳过）与引用重映射
			// （旧 id -> 新 id）都建立在 id 唯一上，重复 id 会让映射指向不确定的行
			if (isset($seen_ids[$parsed['id']])) {
				throw new ValidationException('备份文件格式不正确：存在重复的账号 id', 400);
			}

			$seen_ids[$parsed['id']] = true;

			foreach ($parsed['authorizations'] as $authorization) {
				if (null === $authorization['id']) {
					continue;
				}
				// 授权 id 同样要唯一：replace 模式按文件 id 原样插入，重复会直接撞主键；
				// merge 模式靠它判断「本地是否已有这条授权」
				if (isset($seen_authorization_ids[$authorization['id']])) {
					throw new ValidationException('备份文件格式不正确：存在重复的授权 id', 400);
				}
				$seen_authorization_ids[$authorization['id']] = true;
			}

			$parsed_accounts[] = $parsed;
		}

		return ['meta' => $meta, 'accounts' => $parsed_accounts];
	}

	/**
	 * 解析单条账号：元数据 + 密文列 + 授权关系
	 *
	 * 返回值里的 *_ct / *_iv 是二进制（已 base64 解码），与 Repository::createAccount()
	 * 期望的形态一致；id 是文件里的原始 id，重映射在 Repository::importVaultBackup() 里做。
	 */
	private static function parseAccount($account): array
	{
		if (!is_array($account)) {
			throw new ValidationException('备份文件格式不正确：账号条目必须为对象', 400);
		}

		$id = $account['id'] ?? null;
		if (!self::isPositiveInt($id)) {
			throw new ValidationException('备份文件格式不正确：账号缺少有效 id', 400);
		}

		// 密文结构与账号接口完全一致（{ct, iv}、base64、nonce 12 字节），复用同一校验；
		// AccountPayload::parseSecrets 对「键不存在 / 显式 null / {ct, iv}」三种语义的
		// 处理与导入需求一致（缺省 = 该字段没存）
		$secrets = AccountPayload::parseSecrets(['secrets' => $account['secrets'] ?? null]);

		$data = [
			'id' => (int)$id,
			'name' => self::requiredText($account, 'name', '账号名称', 190),
			'platform' => self::requiredText($account, 'platform', '平台', 40),
			'identifier' => self::requiredText($account, 'identifier', '账号标识', 190),
			'login_url' => self::optionalText($account, 'login_url', '登录地址', 500),
			'favorite' => in_array($account['favorite'] ?? null, [true, 1, '1'], true) ? 1 : 0,
			// 分组只认名称不认 id：不同设备的 account_groups 自增 id 不一定相同，
			// 名称（个人 / 工作 / 客户 / 归档）才是跨设备稳定标识，导入时按名称解析
			'group' => self::optionalGroupName($account['group'] ?? null),
			'login_via_account_id' => self::nullableId($account['login_via_account_id'] ?? null, '关联账号'),
			'password_updated_at' => self::optionalDate($account['password_updated_at'] ?? null),
			'last_used_at' => self::optionalDate($account['last_used_at'] ?? null),
			'created_at' => self::optionalDate($account['created_at'] ?? null),
			'updated_at' => self::optionalDate($account['updated_at'] ?? null),
		];

		$authorizations = $account['authorizations'] ?? [];
		if (!is_array($authorizations)) {
			throw new ValidationException('备份文件格式不正确：authorizations 必须为数组', 400);
		}

		$data['authorizations'] = array_map([self::class, 'parseAuthorization'], $authorizations);

		return array_merge($data, $secrets);
	}

	/**
	 * 解析单条授权关系（PRD §6.4）
	 *
	 * account_id / linked_account_id 保留文件里的旧 id，由导入层统一重映射；
	 * id 仅 replace 模式原样恢复时使用，缺省或非法时留给自增分配。
	 */
	private static function parseAuthorization($authorization): array
	{
		if (!is_array($authorization)) {
			throw new ValidationException('备份文件格式不正确：授权条目必须为对象', 400);
		}

		return [
			'id' => self::optionalId($authorization['id'] ?? null),
			'account_id' => self::requiredId($authorization['account_id'] ?? null, '授权所属账号'),
			'service' => self::requiredText($authorization, 'service', '站点', 120),
			'identifier' => self::optionalText($authorization, 'identifier', '站点账号', 190),
			'note' => self::optionalText($authorization, 'note', '备注', 2000),
			'linked_account_id' => self::nullableId($authorization['linked_account_id'] ?? null, '关联账号'),
			'status' => self::parseStatus($authorization['status'] ?? null),
			'granted_at' => self::optionalDate($authorization['granted_at'] ?? null),
			'created_at' => self::optionalDate($authorization['created_at'] ?? null),
			'updated_at' => self::optionalDate($authorization['updated_at'] ?? null),
		];
	}

	/**
	 * 授权状态：缺省 active，只接受白名单值（与建表 CHECK 约束一致）
	 */
	private static function parseStatus($value): string
	{
		if (null === $value || '' === $value) {
			return 'active';
		}

		$status = is_string($value) ? trim($value) : '';

		if (!in_array($status, AccountPayload::AUTHORIZATION_STATUSES, true)) {
			throw new ValidationException('备份文件格式不正确：授权状态仅支持 active 或 revoked', 400);
		}

		return $status;
	}

	/**
	 * 分组名：字符串或 null（未分组），超长按上限截断是不行的——直接拒绝，
	 * 否则导入后分组名与本地对不上又看不出原因
	 */
	private static function optionalGroupName($value): ?string
	{
		if (null === $value || '' === $value) {
			return null;
		}

		if (!is_string($value)) {
			throw new ValidationException('备份文件格式不正确：分组必须为字符串', 400);
		}

		$name = trim($value);

		if (mb_strlen($name, 'UTF-8') > 40) {
			throw new ValidationException('备份文件格式不正确：分组名不能超过 40 个字符', 400);
		}

		return '' === $name ? null : $name;
	}

	/**
	 * 时间字段：字符串或 null。
	 *
	 * 不做日期格式严格校验：这些值只影响展示与排序，且文件是用户自己导出的，
	 * 严格校验的收益低于「因格式宽容度差异把恢复路径卡死」的代价；
	 * 长度上限仍然要卡，避免异常大的值写进 TEXT 列。
	 */
	private static function optionalDate($value): ?string
	{
		if (null === $value || '' === $value) {
			return null;
		}

		if (!is_string($value)) {
			throw new ValidationException('备份文件格式不正确：时间字段必须为字符串', 400);
		}

		$text = trim($value);

		if (mb_strlen($text, 'UTF-8') > 32) {
			throw new ValidationException('备份文件格式不正确：时间字段长度非法', 400);
		}

		return $text;
	}

	/** 必填正整数 id（授权所属账号） */
	private static function requiredId($value, string $label): int
	{
		if (!self::isPositiveInt($value)) {
			throw new ValidationException("备份文件格式不正确：{$label} id 无效", 400);
		}

		return (int)$value;
	}

	/** 可选正整数 id：null / '' / 0 表示没有，其余必须是正整数 */
	private static function optionalId($value): ?int
	{
		if (null === $value || '' === $value || 0 === $value || '0' === $value) {
			return null;
		}

		if (!self::isPositiveInt($value)) {
			throw new ValidationException('备份文件格式不正确：id 无效', 400);
		}

		return (int)$value;
	}

	/** 可空外键 id：与 optionalId 同语义，仅错误文案不同 */
	private static function nullableId($value, string $label): ?int
	{
		if (null === $value || '' === $value || 0 === $value || '0' === $value) {
			return null;
		}

		if (!self::isPositiveInt($value)) {
			throw new ValidationException("备份文件格式不正确：{$label} id 无效", 400);
		}

		return (int)$value;
	}

	/** 必填文本：trim 后非空，且不超过长度上限 */
	private static function requiredText(array $input, string $key, string $label, int $max_length): string
	{
		$text = self::castText($input[$key] ?? null, $label);

		if ('' === $text) {
			throw new ValidationException("备份文件格式不正确：{$label}不能为空", 400);
		}

		if (mb_strlen($text, 'UTF-8') > $max_length) {
			throw new ValidationException("备份文件格式不正确：{$label}不能超过 {$max_length} 个字符", 400);
		}

		return $text;
	}

	/** 可空文本：缺省为空串，超长同样报错 */
	private static function optionalText(array $input, string $key, string $label, int $max_length): string
	{
		$text = self::castText($input[$key] ?? null, $label);

		if (mb_strlen($text, 'UTF-8') > $max_length) {
			throw new ValidationException("备份文件格式不正确：{$label}不能超过 {$max_length} 个字符", 400);
		}

		return $text;
	}

	private static function castText($value, string $label): string
	{
		if (null === $value) {
			return '';
		}

		if (!is_string($value) && !is_int($value) && !is_float($value)) {
			throw new ValidationException("备份文件格式不正确：{$label}必须为字符串", 400);
		}

		return trim((string)$value);
	}

	private static function isPositiveInt($value): bool
	{
		if (is_int($value)) {
			return $value > 0;
		}
		if (is_string($value) && '' !== $value && ctype_digit($value)) {
			return (int)$value > 0;
		}
		return false;
	}
}
