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

class ServerGroupsPatchController implements ControllerInterface
{
	/**
	 * PATCH /api/servers/groups（refinements-v0.1.2 §3.2）
	 *
	 * body `{ id, name }`：重命名分组。不存在 404，重名 400。
	 * 仓储层在单事务内同步 `server_groups.name` 与 `servers.group_name`，
	 * 不会出现字典是新名、服务器还是旧名的中间态。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$id = ServerPayload::parseGroupId($input['id'] ?? $input['group-id'] ?? null);
		$name = ServerPayload::parseGroupName($input['name'] ?? null);

		$group = $repository->getServerGroupById($id);

		if (!$group) {
			throw new NotFoundException('分组不存在');
		}

		$old_name = (string)$group['name'];

		// 改成同名视为成功（幂等）：设置页允许原样提交表单，用户没有实际改动时
		// 报「分组已存在」会让人以为操作失败；直接返回当前分组，且不触发多余的写库。
		if ($old_name === $name) {
			$group['count'] = $repository->countServersInGroup($old_name);
			return success('分组更新成功', [
				'group' => ServerPayload::formatServerGroup($group),
			]);
		}

		$existing = $repository->getServerGroupByName($name);

		if ($existing && (int)$existing['id'] !== $id) {
			throw new ValidationException("分组「{$name}」已存在", 400);
		}

		if (!$repository->renameServerGroup($id, $name)) {
			throw new NotFoundException('分组不存在');
		}

		$row = $repository->getServerGroupById($id);

		if (!$row) {
			throw new NotFoundException('分组不存在');
		}

		// 重命名只换名称、不改成员集合：按旧名称计数即新名称下的服务器数
		$row['count'] = $repository->countServersInGroup((string)$row['name']);

		return success('分组更新成功', [
			'group' => ServerPayload::formatServerGroup($row),
		]);
	}
}
