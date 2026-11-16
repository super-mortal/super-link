<?php

namespace Utils;

use Framework\Responses\ResponseInterface;
use Models\Repository;
use function Framework\data;

/**
 * agent 态端点共用的 Token 认证与 401 响应（PRD §5.6）
 *
 * connect（GET /api/agent/connect）与 report（POST /api/agent/report）对
 * 「无效 Token」与「不存在的服务器」必须返回逐字节一致的 401——响应体与
 * 耗时都要一致，被监控机无法从失败形态里区分两者，也就没有枚举服务器
 * 存在性的信号（PRD §5.6）。两个端点各写一遍必然漂移，故提取到本类：
 * 两端点调同一方法，一致性由构造保证而非靠人工同步。
 */
class AgentAuth
{
	/** 401 消息：无效 Token 与不存在服务器共用同一常量，保证响应体逐字节一致（PRD §5.6） */
	private const UNAUTHORIZED_MESSAGE = 'Agent 认证失败';

	/**
	 * 拉平耗时用的虚拟校验材料（PRD §5.6）
	 *
	 * 「无效 Token」与「服务器不存在」必须走同一分支且耗时一致。认证是
	 * 「Token 对全部服务器逐条 verify」（盐每服务器随机，无法按哈希检索），
	 * 两种失败场景天然就是同一条代码路径；但库里一台服务器都没有时一次真实
	 * 哈希都不会发生，这里用一对固定值补一次完整的 SHA-256 + hash_equals，
	 * 保证任何失败路径都实打实做过至少一次哈希运算。固定值非机密，唯一目的
	 * 是消耗与真实校验同等的 CPU。
	 */
	private const DUMMY_TOKEN = 'slk_dummy_token_for_timing_equalization';
	private const DUMMY_SALT = 'slk_dummy_salt_for_timing_equalization';
	private const DUMMY_HASH = '5f2b8a1c9e4d7f306a2b9c8d5e1f4a7b3c6d9e2f5a8b1c4d7e0f3a6b9c2d5e8f';

	/**
	 * Token 校验：枚举全部服务器逐条 verify（Utils\ServerToken）
	 *
	 * 盐每服务器随机，无法按 Token 哈希直接检索，只能全量枚举后逐条比对；
	 * 个人级 < 20 台（PRD §5.5）成本可忽略。命中返回该服务器的行（含
	 * paused / last_report_at，供后续流程使用），未命中返回 null——「无效
	 * Token」与「服务器不存在」在此合流，由 unauthorized() 给出逐字节
	 * 一致的 401（PRD §5.6：响应体与耗时都要一致，防枚举）。
	 */
	public static function authenticate(Repository $repository, string $token): ?array
	{
		foreach ($repository->getServerTokenMaterials() as $candidate) {
			if (ServerToken::verify($token, (string)$candidate['token_hash'], (string)$candidate['token_salt'])) {
				return $candidate;
			}
		}

		// 未命中：补一次虚拟哈希比对拉平耗时（固定值材料见类常量注释），
		// 让空库 / 有库两种部署下的失败路径都有同等的哈希运算量
		ServerToken::verify(self::DUMMY_TOKEN, self::DUMMY_HASH, self::DUMMY_SALT);

		return null;
	}

	/**
	 * 401：无效 Token 与不存在服务器共用同一分支
	 *
	 * 信封形态与框架的 JSON 错误响应一致（{ success, message, error }），
	 * 但直接以 data() 返回而不抛 UnauthorizedException：异常路径会按请求的
	 * Accept 头决定返回 JSON 还是 HTML 错误页，agent（Go http client）默认
	 * 不带 Accept: application/json，会拿到无法解析的 HTML。
	 */
	public static function unauthorized(): ResponseInterface
	{
		return data([
			'success' => false,
			'message' => self::UNAUTHORIZED_MESSAGE,
			'error' => self::UNAUTHORIZED_MESSAGE,
		], 401);
	}
}
