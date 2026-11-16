<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerInstallCommand;
use Utils\ServerPayload;
use Utils\ServerToken;
use function Framework\success;

class ServersTokenController implements ControllerInterface
{
	/**
	 * POST /api/servers/token
	 *
	 * 重置 Agent Token（PRD §5.1 / §6）：生成新 Token + 新盐并覆盖旧值，
	 * 旧 Token 在覆盖生效的瞬间即失效（校验是重算哈希后 hash_equals 比对，
	 * 无宽限期，Repository::updateServerToken 注释有展开）。新明文 Token
	 * 只在本响应里完整出现一次，之后任何接口都不再返回（PRD §5.6 / D6
	 * 选项 b）；丢失只能再次重置。
	 *
	 * 与新增（POST /api/servers）返回同形的 { token, install_command }：
	 * 重置弹窗直接把含新 Token 的一行安装命令给用户一键复制，重装 agent
	 * 无需再找历史命令（PRD §5.1）。
	 *
	 * 用户态写操作：走会话认证与 CSRF 中间件（POST 需 X-CSRF-TOKEN），
	 * 与 PATCH /api/servers 同一待遇；agent 态端点才跳过这两层。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 响应体含 Token 明文，禁止任何缓存：浏览器 / 代理把它存下来，
		// 等于把 agent 凭据复制到了第二处（PRD §5.6，同 ServersPostController）
		header('Cache-Control: no-store');

		$repository = ServiceContainer::get(Repository::class);

		$id = ServerPayload::parseId($input['server-id'] ?? $input['server_id'] ?? $input['id'] ?? null);

		$row = $repository->getServerById($id);

		if (!$row) {
			throw new NotFoundException('服务器不存在');
		}

		$token = ServerToken::generate();
		$salt = ServerToken::generateSalt();

		// 哈希与盐覆盖写入即完成轮换：旧 token_hash 被替换的瞬间旧 Token 失效；
		// 明文 Token 不经过 Repository、不写日志，仅通过下方响应返回一次
		if (!$repository->updateServerToken($id, ServerToken::hash($token, $salt), $salt)) {
			throw new DataWriteException('Token 重置失败，请稍后重试');
		}

		return success('Token 重置成功', [
			'token' => $token,
			// 安装命令组装与 Hub 地址推导在 Utils\ServerInstallCommand，
			// 与新增端点共用同一份实现
			'install_command' => ServerInstallCommand::build($token),
		]);
	}
}
