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

class ServersPostController implements ControllerInterface
{
	/**
	 * POST /api/servers
	 *
	 * 新增服务器（PRD §5.1 / §6）：生成服务器与 Agent Token，返回明文 Token
	 * （仅此一次）与一行安装命令。入库的只有 SHA-256(盐 + Token) 与盐本身，
	 * Token 明文不落库、不写日志（PRD §5.6 / D6 选项 b）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 响应体含 Token 明文，禁止任何缓存：浏览器 / 代理把它存下来，
		// 等于把 agent 凭据复制到了第二处（PRD §5.6）
		header('Cache-Control: no-store');

		$repository = ServiceContainer::get(Repository::class);

		// 分组候选值来自 server_groups 字典（refinements-v0.1.2 §3.1）：字典外的
		// 分组在 parseCreate() 里 400；未传分组时由 Repository::createServer()
		// 取 sort 最小的分组补齐
		$group_names = array_column($repository->getServerGroups(), 'name');
		$payload = ServerPayload::parseCreate($input, $group_names);

		$token = ServerToken::generate();
		$salt = ServerToken::generateSalt();

		$id = $repository->createServer([
			...$payload,
			'token_hash' => ServerToken::hash($token, $salt),
			'token_salt' => $salt,
		]);

		if ($id <= 0) {
			throw new DataWriteException('服务器创建失败，请稍后重试');
		}

		// 回读一次再返回：created_at / updated_at 由服务端写入，前端拿到的必须与库里一致
		$row = $repository->getServerById($id);

		if (!$row) {
			throw new NotFoundException('服务器不存在');
		}

		$server = ServerPayload::formatServer($row);
		// 新服务器 agent 尚未连接，状态必然是「等待连接」（PRD §5.1）
		$server['status'] = ServerPayload::resolveStatus($server['paused'], false, null);

		return success('服务器创建成功', [
			'server' => $server,
			// Token 明文只在这一次响应里完整出现，之后任何接口都不再返回；
			// 丢失只能走「重置 Token」（POST /api/servers/token），旧 Token 立即失效
			'token' => $token,
			// 安装命令的组装与 Hub 地址推导在 Utils\ServerInstallCommand，
			// 与重置 Token 端点共用同一份实现
			'install_command' => ServerInstallCommand::build($token),
		]);
	}
}
