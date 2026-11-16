<?php

namespace Utils;

/**
 * Agent Token 的生成、加盐哈希与校验（PRD §5.6）
 *
 * 安全口径：
 * - Token 本身高熵（256 bit 随机），因此哈希用「SHA-256 + 每服务器随机 salt」即可，
 *   不需要 Argon2id 这类 KDF——那是账号库主密码（低熵人类密码）的场景（PRD §5.6 明确区分）。
 * - 哈希与盐落库（servers.token_hash / token_salt），明文只在「新增 / 重置」响应里
 *   完整展示一次，任何路径都不写日志、不入库（PRD D6 选项 b）。
 * - 校验用 hash_equals 常量时间比对，避免时序侧信道逐个字符试出正确前缀。
 */
class ServerToken
{
	/**
	 * Token 明文前缀：便于人工识别（安装命令与 X-Agent-Token 头里一眼看出是 agent 凭据），
	 * 与 mockups/app.js 的 genToken() 的 slk_ 前缀保持一致
	 */
	private const TOKEN_PREFIX = 'slk_';

	/** 随机字节数：32 字节 = 256 bit 熵，base64url 编码后 43 字符 */
	private const TOKEN_BYTES = 32;

	/** 盐长度：16 字节，每服务器独立随机 */
	private const SALT_BYTES = 16;

	/**
	 * 生成新的 Token 明文
	 *
	 * random_bytes 取自 CSPRNG；base64url 无填充编码，避免 + / = 在 shell 命令与
	 * HTTP 头里需要转义（安装命令是一行 curl，Token 直接嵌在命令里）。
	 */
	public static function generate(): string
	{
		return self::TOKEN_PREFIX . self::base64UrlEncode(random_bytes(self::TOKEN_BYTES));
	}

	/**
	 * 生成每服务器独立的随机盐
	 */
	public static function generateSalt(): string
	{
		return self::base64UrlEncode(random_bytes(self::SALT_BYTES));
	}

	/**
	 * 计算 Token 的加盐 SHA-256 哈希（hex）
	 *
	 * 盐拼在 Token 前：同一套盐下不同 Token 的哈希输入前缀相同无实际影响，
	 * 关键是盐每服务器随机——拖库后无法用一张预计算表同时破解所有服务器。
	 */
	public static function hash(string $token, string $salt): string
	{
		return hash('sha256', $salt . $token);
	}

	/**
	 * 校验 Token 明文是否与库中哈希 + 盐匹配
	 *
	 * 先重算再 hash_equals 常量时间比对；两个参数任一为空（脏数据）时直接返回 false，
	 * 不抛异常——调用方（agent 端点）需要统一按 401 处理，不区分「格式错」与「不匹配」。
	 */
	public static function verify(string $token, string $hash, string $salt): bool
	{
		if ('' === $token || '' === $hash || '' === $salt) {
			return false;
		}

		return hash_equals($hash, self::hash($token, $salt));
	}

	/**
	 * base64url 编码（RFC 4648 §5）：+ → -、/ → _、去填充
	 */
	private static function base64UrlEncode(string $bytes): string
	{
		return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
	}
}
