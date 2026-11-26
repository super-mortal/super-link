<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use function Framework\success;

class ServerGroupsGetController implements ControllerInterface
{
	/**
	 * GET /api/servers/groups（refinements-v0.1.2 §3.2）
	 *
	 * 分组字典列表（含每组服务器数量），供设置页「分组」分区与侧栏筛选使用。
	 * 计数由仓储层 LEFT JOIN servers 得出：为 0 的分组也返回，设置页需要展示
	 * 并允许删除。字典规模小，total 直接取返回条数，不再单独查 COUNT。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$groups = array_map(
			fn(array $row): array => ServerPayload::formatServerGroup($row),
			$repository->getServerGroups()
		);

		return success('获取服务器分组成功', [
			'groups' => $groups,
			'total' => count($groups),
		]);
	}
}
