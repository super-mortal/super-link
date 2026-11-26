<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;

class TodosClearDoneController implements ControllerInterface
{
	/**
	 * POST /api/todos/clear-done（PRD docs/prd/todo.md §5.5 / §6.2）
	 *
	 * 无入参：删除全部 done = 1 的待办，返回删除条数供前端更新计数。
	 * 二次确认在浏览器侧完成（PRD T13），服务端只执行，不做软删除。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$deleted = $repository->clearDoneTodos();

		return success('已清除已完成待办', [
			'deleted' => $deleted,
		]);
	}
}
