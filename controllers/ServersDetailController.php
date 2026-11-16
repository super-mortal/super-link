<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use function Framework\success;

class ServersDetailController implements ControllerInterface
{
	/**
	 * GET /api/servers/detail?server-id=
	 *
	 * 服务器详情（PRD §5.5 / §6）：基本信息 + 系统信息冗余列 + 最新 Docker
	 * 快照 + 连接状态 + 最后回传时间。系统信息（os_name / kernel / cpu_cores /
	 * ip_address / agent_version）与 last_report_at 已包含在
	 * ServerPayload::formatServer() 的白名单里，随基本信息一并返回，
	 * 不单独拆字段——agent 版本落后提示由前端对比 Hub 版本后渲染（决策 D12）。
	 *
	 * 不含 token_hash / token_salt，也不返回 Token 明文（PRD D6 选项 b）：
	 * 重装 agent 走「重置 Token」端点（POST /api/servers/token）。
	 *
	 * 服务器不存在（含 id 格式非法）时返回 404，语义与账号库详情
	 * （AccountsDetailGetController）一致：不让调用方从错误形态区分
	 * 「参数写错」与「资源不存在」。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$id = ServerPayload::parseId($input['server-id'] ?? $input['server_id'] ?? $input['id'] ?? null);

		$row = $repository->getServerById($id);

		if (!$row) {
			throw new NotFoundException('服务器不存在');
		}

		$server = ServerPayload::formatServer($row);
		$server['status'] = ServerPayload::resolveStatus(
			$server['paused'],
			null !== $repository->getActiveServerConnectionId($id),
			is_string($server['last_report_at']) ? $server['last_report_at'] : null
		);

		// 最新一批 Docker 容器（一次快照每容器一行，PRD §5.3）：Docker 不可用
		// 或没有容器时为空数组，前端展示空态即可，不影响其余信息
		$docker = array_map(fn(array $container): array => [
			'container' => (string)$container['container'],
			'cpu' => (float)$container['cpu'],
			'mem_used' => (int)$container['mem_used'],
			'mem_limit' => (int)$container['mem_limit'],
			'net_rx' => (int)$container['net_rx'],
			'net_tx' => (int)$container['net_tx'],
			'state' => (string)$container['state'],
			'received_at' => $container['received_at'],
		], $repository->getLatestServerDocker($id));

		return success('获取服务器详情成功', [
			'server' => $server,
			'docker' => $docker,
		]);
	}
}
