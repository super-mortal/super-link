<?php

namespace Utils;

use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Models\Repository;

/**
 * 账号接口的入参校验与出参格式化（PRD §8.2 / §8.3）。
 *
 * 为什么集中在一个类：列表、详情、新建、更新、删除五个端点共用同一套字段白名单、
 * 密文格式规则与输出结构。分散写在各控制器里，很快就会出现「列表能返回、详情解析不了」
 * 这类不一致，也容易在某个端点漏掉密文校验。
 *
 * 明文边界（PRD §7.4 / §7.5）：服务端拿不到 DEK，只负责搬运客户端加密后的 {ct, iv}。
 * 所以这里没有任何解密代码，也不会把密文或请求体写进日志。TOTP secret 的 Base32 校验
 * 同理只能在前端做——服务端看到的永远是密文，这里只校验 base64 结构，不校验业务内容。
 */
class AccountPayload
{
	/**
	 * 三个可加密字段，键名与前端 secrets 对象一致（PRD §6.5）
	 */
	public const SECRET_FIELDS = ['password', 'totp', 'notes'];

	/**
	 * 密文字段的中文名，用于拼接错误提示（提示里绝不出现密文内容）
	 */
	private const SECRET_LABELS = [
		'password' => '密码',
		'totp' => '2FA',
		'notes' => '备注',
	];

	/**
	 * AES-256-GCM nonce 固定 12 字节（PRD §6.5）
	 *
	 * 长度断言是服务端唯一能做的密文结构校验：拿到 12 字节以外的 nonce，
	 * 前端解密必然失败，早一点拒绝比写进库后再排查省事。
	 */
	public const IV_BYTES = 12;

	/**
	 * 长度上限（PRD §8.3）
	 */
	private const MAX_NAME_LENGTH = 190;
	private const MAX_PLATFORM_LENGTH = 40;
	private const MAX_IDENTIFIER_LENGTH = 190;
	private const MAX_LOGIN_URL_LENGTH = 500;

	/**
	 * 授权表字段长度上限（PRD §6.4：站点名、站点账号、备注）
	 *
	 * service 限 120、identifier 限 190 与账号表同名语义字段保持一致，
	 * note 限 2000 是因为它是「用 Google 一键登录」这类自由文本，比账号备注更长；
	 * 上限在这里卡住而不是靠 SQLite（TEXT 不限长），否则超长输入会一路写进库。
	 */
	private const MAX_SERVICE_LENGTH = 120;
	private const MAX_AUTHORIZATION_IDENTIFIER_LENGTH = 190;
	private const MAX_NOTE_LENGTH = 2000;

	/**
	 * 授权状态白名单（PRD §6.4，与建表 CHECK(status IN ('active','revoked')) 一致）
	 */
	public const AUTHORIZATION_STATUSES = ['active', 'revoked'];

	/**
	 * 账号库未初始化时的统一提示与状态码
	 *
	 * 5 个账号端点必须完全一致：前端只要看到这条 message 就跳「设置主密码」，
	 * 状态码不同会让同一个分支被处理成两种结果。
	 */
	public const NOT_INITIALIZED_MESSAGE = '请先设置主密码';
	public const NOT_INITIALIZED_CODE = 409;

	/**
	 * 账号库未初始化时拒绝所有账号操作
	 *
	 * 原因：accounts 表里的密文要用 vault_meta 中包裹的 DEK 才能解开，没有 vault_meta 就
	 * 没有 KEK/DEK，此时写进来的账号以后永远解不开，读出来的密文前端也解不了。
	 * 与其让用户在「半初始化」状态下攒一堆死数据，不如在 API 层统一挡住。
	 */
	public static function assertVaultInitialized(Repository $repository): void
	{
		if (!$repository->getVaultMeta()) {
			throw new ValidationException(self::NOT_INITIALIZED_MESSAGE, self::NOT_INITIALIZED_CODE);
		}
	}

	/**
	 * 解析并校验 id 参数（详情 / 更新 / 批量删除共用）
	 *
	 * 按 PRD §8.3「无效 id 返回 404 语义」处理：既不存在的 id、也不合法格式的 id
	 * 都返回同一个 404 中文提示，避免用不同响应把「资源不存在」和「参数写错」区分开，
	 * 让枚举账号 id 的人少一个信号。
	 */
	public static function parseId($raw): int
	{
		if (!is_int($raw) && !is_string($raw)) {
			throw new NotFoundException('账号不存在');
		}

		$raw = trim((string)$raw);

		if ('' === $raw || !ctype_digit($raw) || (int)$raw <= 0) {
			throw new NotFoundException('账号不存在');
		}

		return (int)$raw;
	}

	/**
	 * 解析新建账号的请求体，返回可直接交给 Repository::createAccount() 的字段
	 *
	 * 返回值里密文列是二进制（已 base64 解码），可直接按 PARAM_LOB 落库。
	 */
	public static function parseCreate(array $input): array
	{
		$data = [
			'name' => self::requiredText($input, 'name', '账号名称', self::MAX_NAME_LENGTH),
			'platform' => self::requiredText($input, 'platform', '平台', self::MAX_PLATFORM_LENGTH),
			'identifier' => self::requiredText($input, 'identifier', '账号标识', self::MAX_IDENTIFIER_LENGTH),
			// login_url 可为空：第三方登录账号没有可记的登录地址，列本身 NOT NULL DEFAULT ''
			'login_url' => self::optionalText($input, 'login_url', '登录地址', self::MAX_LOGIN_URL_LENGTH),
			// favorite 缺省 0（PRD §6.2）
			'favorite' => self::parseFavorite($input['favorite'] ?? null),
		];

		$data = array_merge($data, self::parseRelations($input), self::parseSecrets($input));

		// 新建时就带了密码密文才记录改密日期；没有密码的账号（如第三方登录）保持 NULL，
		// 否则「密码最久未改」排序会把从没存过密码的账号算进去。
		$data['password_updated_at'] = isset($data['password_ct']) ? date('Y-m-d') : null;

		// last_used_at 首版只读（PRD §6.2），不接受客户端写入，避免伪造使用记录
		return $data;
	}

	/**
	 * 解析更新账号的请求体（PATCH 语义）
	 *
	 * 只处理请求里出现的字段：没传的字段（尤其是密文列）保持原值，
	 * 否则前端只想改备注却会把密码密文覆盖成 NULL，账号直接「丢密码」。
	 */
	public static function parseUpdate(array $input): array
	{
		$data = [];

		foreach ([
			'name' => ['账号名称', self::MAX_NAME_LENGTH],
			'platform' => ['平台', self::MAX_PLATFORM_LENGTH],
			'identifier' => ['账号标识', self::MAX_IDENTIFIER_LENGTH],
		] as $key => [$label, $max_length]) {
			if (!array_key_exists($key, $input)) {
				continue;
			}
			$data[$key] = self::requiredText($input, $key, $label, $max_length);
		}

		if (array_key_exists('login_url', $input)) {
			$data['login_url'] = self::optionalText($input, 'login_url', '登录地址', self::MAX_LOGIN_URL_LENGTH);
		}

		if (array_key_exists('favorite', $input)) {
			$data['favorite'] = self::parseFavorite($input['favorite']);
		}

		return array_merge($data, self::parseRelations($input), self::parseSecrets($input));
	}

	/**
	 * 解析批量删除的 id 列表（`{ ids: [1,2,3] }`）
	 */
	public static function parseIds(array $input): array
	{
		$ids = $input['ids'] ?? null;

		if (!is_array($ids) || empty($ids)) {
			throw new ValidationException('请提供要删除的账号 id 列表', 400);
		}

		$normalized = [];
		foreach ($ids as $id) {
			// 非法 id 走与详情一致的 404 语义，不静默跳过：静默跳过会让前端以为删成功
			$normalized[] = self::parseId($id);
		}

		return array_values(array_unique($normalized));
	}

	/**
	 * 校验 group_id / login_via_account_id 指向的记录真实存在
	 *
	 * 原因：本项目的 SQLite 连接没有开启 PRAGMA foreign_keys，外键约束不会生效，
	 * 写入不存在的 id 不会报错，只会留下悬空的引用，前端展示时查不到分组名或关联账号。
	 * 这里显式校验，不存在即 404。
	 */
	public static function assertRelationsExist(Repository $repository, array $data): void
	{
		if (array_key_exists('group_id', $data) && null !== $data['group_id']) {
			if (!$repository->getAccountGroupById((int)$data['group_id'])) {
				throw new NotFoundException('分组不存在');
			}
		}

		if (array_key_exists('login_via_account_id', $data) && null !== $data['login_via_account_id']) {
			if (!$repository->getAccountById((int)$data['login_via_account_id'])) {
				throw new NotFoundException('关联账号不存在');
			}
		}
	}

	/**
	 * 解析并校验授权记录 id（更新 / 删除共用）
	 *
	 * 与 parseId 同理走 404 语义：「格式写错」和「记录不存在」对调用方是同一件事，
	 * 统一成一句「授权记录不存在」不会额外泄露库里有哪些 id。
	 */
	public static function parseAuthorizationId($raw): int
	{
		if (!is_int($raw) && !is_string($raw)) {
			throw new NotFoundException('授权记录不存在');
		}

		$raw = trim((string)$raw);

		if ('' === $raw || !ctype_digit($raw) || (int)$raw <= 0) {
			throw new NotFoundException('授权记录不存在');
		}

		return (int)$raw;
	}

	/**
	 * 解析删除授权的 id 列表：`{ id: 1 }` 或 `{ ids: [1,2] }`
	 *
	 * PRD §8.2 只写了「删除授权关系」一个端点，没规定批量形态；这里兼容两种写法是为了
	 * 和 /api/accounts/delete 的 ids 数组保持一致的调用习惯（详情页一次移除多条时不必循环请求）。
	 */
	public static function parseAuthorizationIds(array $input): array
	{
		$ids = $input['ids'] ?? null;

		if (is_array($ids) && !empty($ids)) {
			$normalized = [];
			foreach ($ids as $id) {
				$normalized[] = self::parseAuthorizationId($id);
			}
			return array_values(array_unique($normalized));
		}

		return [self::parseAuthorizationId($input['id'] ?? null)];
	}

	/**
	 * 解析新建授权的请求体，返回可直接交给 Repository::createAuthorization() 的字段
	 *
	 * 授权字段一律是明文元数据（站点、站点账号、备注、授权日期）。这不是遗漏的加密：
	 * 它们不含任何凭据，只描述「谁在哪个站点用什么身份登录」，前端要靠它做卡片展示、
	 * 筛选和「这个站点用哪个账号」的跳转（PRD §10.4 / §10.5）。加密它们会让服务端
	 * 无法排序筛选、前端也拿不到关联关系，而泄露风险远低于密码 / TOTP / 备注密文。
	 */
	public static function parseAuthorizationCreate(array $input): array
	{
		return [
			'account_id' => self::requiredAuthorizationAccountId($input['account_id'] ?? null),
			'service' => self::requiredText($input, 'service', '站点', self::MAX_SERVICE_LENGTH),
			'identifier' => self::optionalText($input, 'identifier', '站点账号', self::MAX_AUTHORIZATION_IDENTIFIER_LENGTH),
			'note' => self::optionalText($input, 'note', '备注', self::MAX_NOTE_LENGTH),
			'linked_account_id' => self::nullableId($input['linked_account_id'] ?? null, '关联账号'),
			'status' => self::parseAuthorizationStatus($input['status'] ?? null),
			// 授权日期缺省当天：前端新增授权时通常不填日期，写今天比写 NULL 更符合语义，
			// 也避免详情页「授权日期」一栏永远空着
			'granted_at' => self::parseGrantedAt($input['granted_at'] ?? null) ?? date('Y-m-d'),
		];
	}

	/**
	 * 解析更新授权的请求体（PATCH 语义）
	 *
	 * 只处理请求里出现的字段：未传的列保持原值，避免前端只想改备注却把
	 * service / status 覆盖成空值。显式传 null 的可空字段（linked_account_id、granted_at）
	 * 表示清空，与账号更新里的 secrets 语义一致。
	 */
	public static function parseAuthorizationUpdate(array $input): array
	{
		$data = [];

		if (array_key_exists('account_id', $input)) {
			$data['account_id'] = self::requiredAuthorizationAccountId($input['account_id']);
		}

		if (array_key_exists('service', $input)) {
			$data['service'] = self::requiredText($input, 'service', '站点', self::MAX_SERVICE_LENGTH);
		}

		if (array_key_exists('identifier', $input)) {
			$data['identifier'] = self::optionalText($input, 'identifier', '站点账号', self::MAX_AUTHORIZATION_IDENTIFIER_LENGTH);
		}

		if (array_key_exists('note', $input)) {
			$data['note'] = self::optionalText($input, 'note', '备注', self::MAX_NOTE_LENGTH);
		}

		if (array_key_exists('linked_account_id', $input)) {
			$data['linked_account_id'] = self::nullableId($input['linked_account_id'], '关联账号');
		}

		if (array_key_exists('status', $input)) {
			$data['status'] = self::parseAuthorizationStatus($input['status']);
		}

		if (array_key_exists('granted_at', $input)) {
			$data['granted_at'] = self::parseGrantedAt($input['granted_at']);
		}

		return $data;
	}

	/**
	 * 校验授权关系的两个外键：account_id 必须存在，linked_account_id 必须存在且不能指向自己
	 *
	 * $existing 传入原记录时按「合并后的有效值」校验：请求里传了就用新值，没传就沿用库里现有值。
	 * 只改一个字段的部分更新也必须这样判断——否则 `{account_id: 2}` 把授权挪到账号 2、
	 * 而库里 linked_account_id 恰好是 2 时，就会漏掉自环检查留下 A→A 的数据。
	 *
	 * 显式传 null 表示清空关联，此时 merged 值为 null，不参与自环判断（清空永远合法）。
	 */
	public static function assertAuthorizationReferences(
		Repository $repository,
		array $data,
		?array $existing = null
	): void {
		$account_id = array_key_exists('account_id', $data)
			? $data['account_id']
			: (isset($existing['account_id']) ? (int)$existing['account_id'] : null);

		$linked_account_id = array_key_exists('linked_account_id', $data)
			? $data['linked_account_id']
			: (isset($existing['linked_account_id']) ? (int)$existing['linked_account_id'] : null);

		if (null !== $account_id && !$repository->getAccountById((int)$account_id)) {
			// 来源账号不存在属于「资源不存在」，按 PRD §8.3 用 404 语义
			throw new NotFoundException('账号不存在');
		}

		if (null === $linked_account_id) {
			return;
		}

		$linked_id = (int)$linked_account_id;

		if (!$repository->getAccountById($linked_id)) {
			// 关联账号是请求体里的可选引用，写错属于参数问题，用 400 而不是 404：
			// 404 会让前端以为「这条授权不存在」，而这其实是表单填错了
			throw new ValidationException('关联账号不存在', 400);
		}

		if (null !== $account_id && $linked_id === (int)$account_id) {
			// 自己不能授权给自己：授权关系表达的是「A 的登录依赖 B」，A→A 既无信息量，
			// 还会让详情页的「关联账号」入口跳到当前页、形成自环；这里直接拒绝
			throw new ValidationException('关联账号不能是授权所属账号自身', 400);
		}
	}

	/**
	 * 单行账号 → API 输出结构（元数据 + 密文，绝无明文）
	 */
	public static function formatAccount(array $row, ?string $group_name): array
	{
		return [
			'id' => (int)$row['id'],
			'name' => (string)$row['name'],
			'platform' => (string)$row['platform'],
			'identifier' => (string)$row['identifier'],
			// group 是分组名（PRD §8.2 示例）；group_id 一并返回，前端编辑与筛选要用 id
			'group' => $group_name,
			'group_id' => isset($row['group_id']) ? (int)$row['group_id'] : null,
			'login_url' => (string)($row['login_url'] ?? ''),
			'login_via_account_id' => isset($row['login_via_account_id']) ? (int)$row['login_via_account_id'] : null,
			'favorite' => 1 === (int)($row['favorite'] ?? 0),
			'password_updated_at' => $row['password_updated_at'] ?? null,
			'last_used_at' => $row['last_used_at'] ?? null,
			'created_at' => $row['created_at'] ?? null,
			'updated_at' => $row['updated_at'] ?? null,
			'secrets' => self::formatSecrets($row),
		];
	}

	/**
	 * 授权关系行 → API 输出结构（PRD §6.4）
	 */
	public static function formatAuthorization(array $row): array
	{
		return [
			'id' => (int)$row['id'],
			'account_id' => (int)$row['account_id'],
			'service' => (string)$row['service'],
			'identifier' => (string)$row['identifier'],
			'note' => (string)($row['note'] ?? ''),
			'linked_account_id' => isset($row['linked_account_id']) ? (int)$row['linked_account_id'] : null,
			'status' => (string)$row['status'],
			'granted_at' => $row['granted_at'] ?? null,
			'created_at' => $row['created_at'] ?? null,
			'updated_at' => $row['updated_at'] ?? null,
		];
	}

	/**
	 * 密文输出：{ password: {ct, iv}, totp: {...}, notes: {...} }
	 *
	 * 字段没有密文时返回 null（不是空对象）：前端据此区分「没存这个字段」和
	 * 「存了但解不开」，也避免把空 base64 当成有效密文去解密、报无意义的解密失败。
	 */
	private static function formatSecrets(array $row): array
	{
		$secrets = [];

		foreach (self::SECRET_FIELDS as $field) {
			$ct = $row[$field . '_ct'] ?? null;
			$iv = $row[$field . '_iv'] ?? null;

			$secrets[$field] = (null === $ct && null === $iv) ? null : [
				'ct' => VaultMetaPayload::encodeBlob($ct),
				'iv' => VaultMetaPayload::encodeBlob($iv),
			];
		}

		return $secrets;
	}

	/**
	 * 解析 secrets 对象，返回 *_ct / *_iv 二进制列
	 *
	 * 支持三种语义：
	 *   - 键不存在：不动该字段（PATCH 语义）；
	 *   - 显式 null：清空该字段（例如用户删掉了备注），密文与 nonce 一起置 NULL；
	 *   - {ct, iv}：base64 解码后入库，iv 必须 12 字节、ct 不能为空。
	 */
	private static function parseSecrets(array $input): array
	{
		$data = [];

		if (!array_key_exists('secrets', $input) || null === $input['secrets']) {
			return $data;
		}

		if (!is_array($input['secrets'])) {
			throw new ValidationException('密文字段格式不正确，secrets 必须为对象', 400);
		}

		$matched = 0;

		foreach (self::SECRET_FIELDS as $field) {
			if (!array_key_exists($field, $input['secrets'])) {
				continue;
			}

			$matched++;
			$label = self::SECRET_LABELS[$field];
			$payload = $input['secrets'][$field];

			if (null === $payload) {
				$data[$field . '_ct'] = null;
				$data[$field . '_iv'] = null;
				continue;
			}

			if (!is_array($payload)) {
				throw new ValidationException("{$label}密文格式不正确，必须包含 ct 与 iv", 400);
			}

			$ct = self::decodeBase64($payload['ct'] ?? null, "{$label}密文");
			$iv = self::decodeBase64($payload['iv'] ?? null, "{$label} nonce");

			if (self::IV_BYTES !== strlen($iv)) {
				throw new ValidationException("{$label} nonce 必须为 12 字节", 400);
			}

			// ct 至少要有 16 字节 GCM tag + 1 字节正文，这里只做「非空」下限，
			// 具体长度由前端算法决定，服务端不猜。
			if ('' === $ct) {
				throw new ValidationException("{$label}密文不能为空", 400);
			}

			$data[$field . '_ct'] = $ct;
			$data[$field . '_iv'] = $iv;
		}

		// 一个已知字段都没匹配上，说明前端传了别的键名（例如旧的扁平 *_ct 写法），
		// 静默忽略会让用户以为保存成功，这里直接报错。
		if (0 === $matched && !empty($input['secrets'])) {
			throw new ValidationException('密文字段格式不正确，仅支持 password / totp / notes', 400);
		}

		return $data;
	}

	/**
	 * 解析分组与「通过哪个账号登录」两个可选外键
	 *
	 * 兼容 group_id（数字）与 group（前端详情输出里的同名键）；显式 null / 0 表示未设置。
	 */
	private static function parseRelations(array $input): array
	{
		$data = [];

		if (array_key_exists('group_id', $input) || array_key_exists('group', $input)) {
			$raw = array_key_exists('group_id', $input) ? $input['group_id'] : $input['group'];
			$data['group_id'] = self::nullableId($raw, '分组');
		}

		if (array_key_exists('login_via_account_id', $input)) {
			$data['login_via_account_id'] = self::nullableId($input['login_via_account_id'], '关联账号');
		}

		return $data;
	}

	/**
	 * 可空外键 id：null / '' / 0 表示「不设置」，其余必须是正整数
	 */
	private static function nullableId($value, string $label): ?int
	{
		if (null === $value || '' === $value || 0 === $value || '0' === $value) {
			return null;
		}

		if (is_int($value) && $value > 0) {
			return $value;
		}

		if (is_string($value) && ctype_digit(trim($value)) && (int)trim($value) > 0) {
			return (int)trim($value);
		}

		throw new ValidationException("{$label} id 格式不正确", 400);
	}

	/**
	 * 授权所属账号 id：必填，且必须是正整数（存在性由 assertAuthorizationReferences 校验）
	 */
	private static function requiredAuthorizationAccountId($value): int
	{
		if (null === $value || '' === $value || 0 === $value || '0' === $value) {
			throw new ValidationException('来源账号不能为空', 400);
		}

		if (is_int($value) && $value > 0) {
			return $value;
		}

		if (is_string($value) && ctype_digit(trim($value)) && (int)trim($value) > 0) {
			return (int)trim($value);
		}

		throw new ValidationException('来源账号 id 格式不正确', 400);
	}

	/**
	 * 授权状态：缺省 active，只接受白名单值
	 *
	 * 这里不套用 Repository::normalizeAuthorizationStatus() 的「非法即回落 active」：
	 * 那是写库时的兜底，接口层如果也静默回落，前端把 status 拼错时会以为改成功了。
	 */
	private static function parseAuthorizationStatus($value): string
	{
		if (null === $value || '' === $value) {
			return 'active';
		}

		if (!is_string($value)) {
			throw new ValidationException('授权状态不正确，仅支持 active 或 revoked', 400);
		}

		$status = trim($value);

		if (!in_array($status, self::AUTHORIZATION_STATUSES, true)) {
			throw new ValidationException('授权状态不正确，仅支持 active 或 revoked', 400);
		}

		return $status;
	}

	/**
	 * 授权日期：接受 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS，空值返回 null（由调用方决定缺省值）
	 *
	 * 用「解析后再按同一格式回写比对」做严格校验：DateTime::createFromFormat 对
	 * 2026-1-1 这类宽松写法也会成功，而库里按字符串排序，格式不统一会让排序错乱。
	 */
	private static function parseGrantedAt($value): ?string
	{
		if (null === $value || '' === $value) {
			return null;
		}

		if (!is_string($value)) {
			throw new ValidationException('授权日期格式不正确，应为 YYYY-MM-DD', 400);
		}

		$text = trim($value);

		foreach (['Y-m-d', 'Y-m-d H:i:s'] as $format) {
			$date = \DateTime::createFromFormat('!' . $format, $text);

			if ($date instanceof \DateTime && $date->format($format) === $text) {
				return $text;
			}
		}

		throw new ValidationException('授权日期格式不正确，应为 YYYY-MM-DD', 400);
	}

	/**
	 * favorite 归一为 0/1，与建表 CHECK(favorite IN (0, 1)) 保持一致
	 */
	private static function parseFavorite($value): int
	{
		return in_array($value, [true, 1, '1', 'true'], true) ? 1 : 0;
	}

	/**
	 * 必填文本：trim 后非空，且不超过长度上限（PRD §8.3）
	 */
	private static function requiredText(array $input, string $key, string $label, int $max_length): string
	{
		$text = self::castText($input[$key] ?? null, $label);

		if ('' === $text) {
			throw new ValidationException("{$label}不能为空", 400);
		}

		if (mb_strlen($text, 'UTF-8') > $max_length) {
			throw new ValidationException("{$label}不能超过 {$max_length} 个字符", 400);
		}

		return $text;
	}

	/**
	 * 可空文本：缺省为空串（列 NOT NULL DEFAULT ''），超长同样报错
	 */
	private static function optionalText(array $input, string $key, string $label, int $max_length): string
	{
		$text = self::castText($input[$key] ?? null, $label);

		if (mb_strlen($text, 'UTF-8') > $max_length) {
			throw new ValidationException("{$label}不能超过 {$max_length} 个字符", 400);
		}

		return $text;
	}

	private static function castText($value, string $label): string
	{
		if (null === $value) {
			return '';
		}

		if (!is_string($value) && !is_int($value) && !is_float($value)) {
			throw new ValidationException("{$label}格式不正确，必须为字符串", 400);
		}

		return trim((string)$value);
	}

	/**
	 * 严格 base64 解码：遇到非法字符直接失败，不做「尽量修补」，
	 * 避免把解错的字节写进库后前端解密时报无法定位的错误。
	 */
	private static function decodeBase64($value, string $label): string
	{
		if (null === $value || '' === $value) {
			throw new ValidationException("{$label}不能为空", 400);
		}

		if (!is_string($value)) {
			throw new ValidationException("{$label}必须为 base64 字符串", 400);
		}

		$decoded = base64_decode($value, true);

		if (false === $decoded) {
			throw new ValidationException("{$label}格式不正确，必须为合法 base64", 400);
		}

		return $decoded;
	}
}
