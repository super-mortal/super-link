<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use function Framework\success;

class ServerGroupsDeleteController implements ControllerInterface
{
	/**
	 * POST /api/servers/groups/delete（refinements-v0.1.2 §3.2）
	 *
	 * body `{ id }`：删除服务器分组。用 POST 而不是 DELETE，与 items / accounts /
	 * skills / servers 的删除端点一致（带请求体的 DELETE 在部分代理上会被丢）。
	 *
	 * 两道守卫：
	 * 1. 非空分组 400「分组「x」下还有 N 台服务器，请先移出后再删除」——
	 *    服务器按名称存分组，删字典行不会级联改服务器，放任删除会留下悬空分组名；
	 * 2. 至少保留一个分组（只剩一个时 400）——新增服务器 / 备份恢复都要用
	 *    sort 最小的分组做缺省值，字典清空后没有落点。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$id = ServerPayload::parseGroupId($input['id'] ?? $input['group-id'] ?? null);

		$group = $repository->getServerGroupById($id);

		if (!$group) {
			throw new NotFoundException('分组不存在');
		}

		$name = (string)$group['name'];
		$server_count = $repository->countServersInGroup($name);

		if ($server_count > 0) {
			throw new ValidationException("分组「{$name}」下还有 {$server_count} 台服务器，请先移出后再删除", 400);
		}

		if ($repository->countServerGroups() <= 1) {
			throw new ValidationException('至少保留一个分组，无法删除最后一个分组', 400);
		}

		// 删除期间若被并发删掉，rowCount 为 0：按 404 处理，避免前端以为删成功了
		if (!$repository->deleteServerGroup($id)) {
			throw new NotFoundException('分组不存在');
		}

		return success('分组删除成功', [
			'id' => $id,
			'name' => $name,
		]);
	}
}
