<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use function Framework\success;

class ServersPatchController implements ControllerInterface
{
	/**
	 * PATCH /api/servers
	 *
	 * 改名 / 备注 / 分组 / 暂停恢复（PRD §5.1 / §6）。PATCH 语义：请求里没传的
	 * 字段一律保持原值（见 ServerPayload::parsePatch），前端只想改备注时不会
	 * 把分组冲掉、把暂停的服务器恢复。
	 *
	 * server-id 走查询串或请求体均可：框架的 getInput() 会把 $_GET 合并进
	 * $input（JSON 请求体同样合并），三种键名（server-id / server_id / id）
	 * 都认，与 PRD §6「子路径 + 查询串传 id」的端点惯例对齐。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$id = ServerPayload::parseId($input['server-id'] ?? $input['server_id'] ?? $input['id'] ?? null);

		$row = $repository->getServerById($id);

		if (!$row) {
			throw new NotFoundException('服务器不存在');
		}

		$payload = ServerPayload::parsePatch($input);

		// 空请求直接拒绝：updateServer() 对空字段也会刷新 updated_at，
		// 放过去会让「用户编辑时间」被一次空请求刷掉，排序失去意义
		if (empty($payload)) {
			throw new ValidationException('没有需要更新的字段', 400);
		}

		if (!$repository->updateServer($id, $payload)) {
			throw new DataWriteException('服务器更新失败，请稍后重试');
		}

		$row = $repository->getServerById($id);

		if (!$row) {
			throw new NotFoundException('服务器不存在');
		}

		$server = ServerPayload::formatServer($row);
		// 暂停 / 恢复会改变状态判定，随响应带回最新状态，前端不必再拉一次列表
		$server['status'] = ServerPayload::resolveStatus(
			$server['paused'],
			null !== $repository->getActiveServerConnectionId($id),
			is_string($server['last_report_at']) ? $server['last_report_at'] : null
		);

		return success('服务器更新成功', ['server' => $server]);
	}
}
