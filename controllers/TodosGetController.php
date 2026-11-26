<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\TodoPayload;
use function Framework\data;

class TodosGetController implements ControllerInterface
{
	/**
	 * GET /api/todos（PRD docs/prd/todo.md §6.2）
	 *
	 * 全量返回裸数组（data() envelope，不走 success 包裹），首版不分页、
	 * 不分段，按 created_at DESC 排序（Repository 已追加 id DESC 兜底），
	 * 分段 / 搜索 / 筛选全部由前端完成。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$todos = array_map(
			[TodoPayload::class, 'formatTodo'],
			$repository->getTodos()
		);

		return data($todos);
	}
}
