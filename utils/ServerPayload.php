<?php

namespace Utils;

use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;

/**
 * 服务器接口的入参校验与出参格式化（PRD §5.1 / §6）
 *
 * 为什么集中在一个类：列表、新增、更新、删除四个端点共用同一套分组白名单、
 * 字段长度上限与输出结构。分散写在各控制器里，很快就会出现「新增校验了分组、
 * 更新忘了校验」这类不一致。与账号库的 AccountPayload 同一模式。
 *
 * 敏感列边界：servers 的 token_hash / token_salt 是服务端凭据材料（PRD §5.6 / D6），
 * formatServer() 只输出白名单字段——即使调用方传入的是 getServerById() 的完整行
 * （含哈希与盐），也会在这里被剔除，用户态响应不接触这两列。
 */
class ServerPayload
{
	/**
	 * 连接状态枚举（PRD §5.1 卡片状态点）
	 *
	 * online  在线——连接注册表有未过期连接
	 * offline 离线——曾回传过数据，但当前无活跃连接
	 * paused  已暂停——paused 标志置位，暂停期间不做离线判定
	 * pending 等待连接——从未回传过数据（新添加、agent 还没连上）
	 */
	public const STATUS_ONLINE = 'online';
	public const STATUS_OFFLINE = 'offline';
	public const STATUS_PAUSED = 'paused';
	public const STATUS_PENDING = 'pending';

	/**
	 * 分组白名单（PRD §5.1 / 决策 D10：固定四项，与账号库分组同一处理方式，不参与权限）
	 *
	 * 写操作传白名单外的值一律 400 拒绝，不静默回落——前端把分组拼错时应当立刻知道，
	 * 而不是以为保存成功、回头发现服务器跑到了「家庭」分组里。
	 */
	public const GROUPS = ['家庭', '公网', '公司', '归档'];

	/** 字段长度上限（与账号库同名字段对齐） */
	private const MAX_NAME_LENGTH = 190;
	private const MAX_NOTE_LENGTH = 2000;

	/**
	 * 解析并校验服务器 id（更新 / 删除共用）
	 *
	 * 按 PRD §8.3 同款语义处理：格式非法的 id 与不存在的 id 都返回同一个 404 提示，
	 * 不让调用方从错误形态里区分「参数写错」和「资源不存在」，少一个枚举 id 的信号。
	 */
	public static function parseId($raw): int
	{
		if (!is_int($raw) && !is_string($raw)) {
			throw new NotFoundException('服务器不存在');
		}

		$raw = trim((string)$raw);

		if ('' === $raw || !ctype_digit($raw) || (int)$raw <= 0) {
			throw new NotFoundException('服务器不存在');
		}

		return (int)$raw;
	}

	/**
	 * 解析新建服务器的请求体，返回可直接交给 Repository::createServer() 的字段
	 *
	 * 不含 token_hash / token_salt：Token 由控制器经 Utils\ServerToken 生成后单独传入，
	 * 与「名称 / 备注」这类普通编辑保持隔离（PRD §5.6：Token 轮换是独立流程）。
	 */
	public static function parseCreate(array $input): array
	{
		return [
			'name' => self::requiredText($input, 'name', '服务器名称', self::MAX_NAME_LENGTH),
			'note' => self::optionalText($input, 'note', '备注', self::MAX_NOTE_LENGTH),
			// 分组缺省「家庭」：与建表默认值、新增弹窗的预选一致（PRD §5.1）
			'group_name' => self::parseGroup($input['group'] ?? $input['group_name'] ?? null) ?? '家庭',
		];
	}

	/**
	 * 解析更新服务器的请求体（PATCH 语义）
	 *
	 * 只处理请求里出现的字段：没传的字段（包括 paused）保持原值，
	 * 否则前端只想改备注就会把分组冲掉、把暂停的服务器恢复。
	 * paused 显式传 null 视为非法——暂停 / 恢复是二值动作，必须给明确值。
	 */
	public static function parsePatch(array $input): array
	{
		$data = [];

		if (array_key_exists('name', $input)) {
			$data['name'] = self::requiredText($input, 'name', '服务器名称', self::MAX_NAME_LENGTH);
		}

		if (array_key_exists('note', $input)) {
			$data['note'] = self::optionalText($input, 'note', '备注', self::MAX_NOTE_LENGTH);
		}

		if (array_key_exists('group', $input) || array_key_exists('group_name', $input)) {
			$raw = array_key_exists('group', $input) ? $input['group'] : $input['group_name'];
			$group = self::parseGroup($raw);
			// PATCH 里传空串表示「想清空分组」没有意义（白名单外），直接拒绝而不是回落默认值
			if (null === $group) {
				throw new ValidationException('分组不能为空，仅支持 ' . implode(' / ', self::GROUPS), 400);
			}
			$data['group_name'] = $group;
		}

		if (array_key_exists('paused', $input)) {
			$data['paused'] = self::parsePaused($input['paused']);
		}

		return $data;
	}

	/**
	 * 解析分组值：仅接受白名单四项，缺省（null / 空串）返回 null 由调用方决定默认行为
	 *
	 * 写接口用 parseGroup(null) === null 走默认值，白名单外 400；读接口（列表筛选）
	 * 的白名单外值同样 400——筛选条件拼错时静默返回全量，比报错更容易让人看错数据。
	 */
	public static function parseGroup($value): ?string
	{
		// 未传（null）或显式空串都视为「不筛选 / 用默认值」，由调用方决定
		if (null === $value || (is_string($value) && '' === trim($value))) {
			return null;
		}

		if (!is_string($value)) {
			throw new ValidationException('分组格式不正确，仅支持 ' . implode(' / ', self::GROUPS), 400);
		}

		$group = trim($value);

		if (!in_array($group, self::GROUPS, true)) {
			throw new ValidationException('分组仅支持 ' . implode(' / ', self::GROUPS), 400);
		}

		return $group;
	}

	/**
	 * 解析 paused 标志：归一为 0 / 1（与建表 CHECK(paused IN (0, 1)) 一致）
	 *
	 * 同时接纳 JSON 布尔与查询串字符串两种来源：PATCH /api/servers 的 id 与字段都允许
	 * 走 body 或 query（框架把 $_GET 合并进 $input），两种来源的类型不同必须都认。
	 */
	public static function parsePaused($value): int
	{
		if (is_bool($value)) {
			return $value ? 1 : 0;
		}

		if (is_int($value) && (0 === $value || 1 === $value)) {
			return $value;
		}

		if (is_string($value)) {
			$normalized = strtolower(trim($value));
			if (in_array($normalized, ['1', 'true'], true)) {
				return 1;
			}
			if (in_array($normalized, ['0', 'false'], true)) {
				return 0;
			}
		}

		throw new ValidationException('paused 参数格式不正确，应为布尔值或 0 / 1', 400);
	}

	/**
	 * 连接状态判定（PRD §5.1 / §5.2）
	 *
	 * 优先级：已暂停 > 在线（注册表有活跃连接）> 等待连接（从未回传）> 离线。
	 * 暂停中的服务器不判定离线（PRD §5.1）；last_report_at 为空即「agent 从未连上」，
	 * 此时即便注册表里没有连接也不叫离线——卡片要展示「等待连接」引导，而不是红色离线。
	 *
	 * @param bool       $paused            servers.paused
	 * @param bool       $connection_active 连接注册表是否存在未过期连接（server_connections）
	 * @param string|null $last_report_at   servers.last_report_at，空 = 从未回传
	 */
	public static function resolveStatus(bool $paused, bool $connection_active, ?string $last_report_at): string
	{
		if ($paused) {
			return self::STATUS_PAUSED;
		}

		if ($connection_active) {
			return self::STATUS_ONLINE;
		}

		if (null === $last_report_at || '' === $last_report_at) {
			return self::STATUS_PENDING;
		}

		return self::STATUS_OFFLINE;
	}

	/**
	 * 单行服务器 → API 输出结构
	 *
	 * 只输出 SERVER_PUBLIC_COLUMNS 同款字段：调用方传 getServerById() 的完整行时，
	 * token_hash / token_salt 在这里被天然剔除（不读取即不输出），
	 * 这是用户态响应不泄露凭据材料的最后一道闸（PRD §5.6 / D6 选项 b）。
	 * paused 归一为布尔，与前端开关组件的值类型一致。
	 */
	public static function formatServer(array $row): array
	{
		return [
			'id' => (int)$row['id'],
			'name' => (string)($row['name'] ?? ''),
			'note' => (string)($row['note'] ?? ''),
			// 列名叫 group_name（避开 SQL 关键字歧义，见 Repository 建表注释），
			// 对外统一输出 group，与账号库 formatAccount 的键名风格一致
			'group' => (string)($row['group_name'] ?? ''),
			'paused' => 1 === (int)($row['paused'] ?? 0),
			'os_name' => (string)($row['os_name'] ?? ''),
			'kernel' => (string)($row['kernel'] ?? ''),
			'cpu_cores' => (int)($row['cpu_cores'] ?? 0),
			'ip_address' => (string)($row['ip_address'] ?? ''),
			'agent_version' => (string)($row['agent_version'] ?? ''),
			'last_report_at' => $row['last_report_at'] ?? null,
			'created_at' => $row['created_at'] ?? null,
			'updated_at' => $row['updated_at'] ?? null,
		];
	}

	/**
	 * 必填文本：trim 后非空，且不超过长度上限
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
}
