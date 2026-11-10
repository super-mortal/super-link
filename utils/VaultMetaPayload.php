<?php

namespace Utils;

use Framework\Exceptions\ValidationException;

/**
 * 账号库元信息的入参解析与出参编码。
 *
 * 为什么集中在一个类里：`POST /api/vault/setup` 与 `POST /api/vault/change-master`
 * 的入参完全一致，读取端 `GET /api/vault/meta` 又必须与写入端使用同一套 base64 规则，
 * 放在这里可以避免四个控制器各写一份校验与编码。
 *
 * 传输约定：密文字段（salt / wrapped_dek / wrap_nonce）在 JSON 里是 base64 字符串，
 * 落库是 BLOB 二进制。JSON 表达不了原始二进制，PHP 把随机字节当 UTF-8 字符串处理时
 * json_encode 会因非法编码失败，所以两端都必须做 base64 转换。
 */
class VaultMetaPayload
{
	/**
	 * 首版加密格式版本（PRD §6.1）
	 */
	public const DEFAULT_VERSION = 1;

	/**
	 * 允许的 KDF 算法：优先 argon2id，运行环境不支持时降级 pbkdf2-sha256（PRD §7.1）
	 */
	public const KDF_ALGORITHMS = ['argon2id', 'pbkdf2-sha256'];

	/**
	 * 解析并校验初始化 / 更换主密码的请求体，返回可直接写库的字段（密文已解码为二进制）
	 *
	 * @throws ValidationException 缺参或格式不合法时抛出，message 为普通中文
	 */
	public static function parse(array $input): array
	{
		$kdf = trim((string)($input['kdf'] ?? ''));
		if ('' === $kdf) {
			throw new ValidationException('KDF 算法不能为空', 400);
		}
		if (!in_array($kdf, self::KDF_ALGORITHMS, true)) {
			// 白名单而不是存什么算什么：算法名会写进 vault_meta，解锁时前端按它派生 KEK，
			// 存进未知算法会导致以后再也解不开。
			throw new ValidationException('不支持的 KDF 算法，仅支持 argon2id 或 pbkdf2-sha256', 400);
		}

		// version 可选，缺省为首版格式；显式传入时必须是正整数，避免写入无法识别的格式号
		$version = $input['version'] ?? self::DEFAULT_VERSION;
		if (!self::isPositiveInt($version)) {
			throw new ValidationException('加密格式版本必须为正整数', 400);
		}

		return [
			'version' => (int)$version,
			'kdf' => $kdf,
			'kdf_memory' => self::positiveIntField($input, 'kdf_memory', 'KDF 内存成本'),
			'kdf_iterations' => self::positiveIntField($input, 'kdf_iterations', 'KDF 迭代次数'),
			'kdf_parallelism' => self::positiveIntField($input, 'kdf_parallelism', 'KDF 并行度'),
			// 兼容两种键名：前端按 PRD 输出字段叫 salt，库内列名是 kdf_salt
			'kdf_salt' => self::decodeBase64Field($input, 'salt', '盐值', 'kdf_salt'),
			'wrapped_dek' => self::decodeBase64Field($input, 'wrapped_dek', '被包裹的数据密钥'),
			'wrap_nonce' => self::decodeBase64Field($input, 'wrap_nonce', '包裹 nonce'),
		];
	}

	/**
	 * BLOB 值转 base64，用于 JSON 输出
	 *
	 * SQLite PDO 正常返回字符串；个别配置下 LOB 列可能返回流资源，这里统一兼容。
	 */
	public static function encodeBlob($value): string
	{
		if (is_resource($value)) {
			$contents = stream_get_contents($value);
			return base64_encode(false === $contents ? '' : $contents);
		}
		return base64_encode((string)$value);
	}

	/**
	 * 账号库所有响应都禁止缓存（PRD §7.5）：KDF 元信息与密文不允许被浏览器 / 代理缓存
	 *
	 * Framework\Responses\DataResponse 本身已输出 `no-cache, no-store, must-revalidate`，
	 * 这里再显式声明一次，保证以后换成其它响应类型时也不会丢掉 no-store。
	 */
	public static function noStore(): void
	{
		header('Cache-Control: no-store');
	}

	/**
	 * 读取必填的正整数字段（允许 JSON 数字或数字字符串）
	 */
	private static function positiveIntField(array $input, string $key, string $label): int
	{
		$value = $input[$key] ?? null;
		if (null === $value || '' === $value) {
			throw new ValidationException("{$label}不能为空", 400);
		}
		if (!self::isPositiveInt($value)) {
			throw new ValidationException("{$label}必须为正整数", 400);
		}
		return (int)$value;
	}

	/**
	 * 读取必填的 base64 字段并解码为二进制
	 *
	 * 只校验「是否是合法 base64 且不是空串」，不强制字节长度：盐 16 字节、nonce 12 字节
	 * 由前端按 PRD §7.1 生成，服务端长度校验没有额外安全收益，反而会让前端换算法时被卡住。
	 */
	private static function decodeBase64Field(array $input, string $key, string $label, string $fallback_key = ''): string
	{
		$value = $input[$key] ?? ('' !== $fallback_key ? ($input[$fallback_key] ?? null) : null);

		if (null === $value || '' === $value) {
			throw new ValidationException("{$label}不能为空", 400);
		}
		if (!is_string($value)) {
			throw new ValidationException("{$label}必须为 base64 字符串", 400);
		}

		// 严格模式：遇到非法字符直接返回 false，不做「尽量修补」，避免把坏数据写进库
		$decoded = base64_decode($value, true);
		if (false === $decoded || '' === $decoded) {
			throw new ValidationException("{$label}格式不正确，必须为合法 base64", 400);
		}

		return $decoded;
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
