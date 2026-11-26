<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\TodoPayload;
use function Framework\success;

class TodosDeleteController implements ControllerInterface
{
	/**
	 * POST /api/todos/delete（PRD docs/prd/todo.md §5.6 / §6.2）
	 *
	 * 用 POST 而不是 DELETE：Router 无路径参数，且带请求体的 DELETE 在部分
	 * 代理上会被丢，与 items / accounts / skills / servers 的删除端点一致。
	 * id 走请求体；删除不存在的 id 按 400「待办不存在」处理，避免前端以为删成功。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$id = TodoPayload::parseId($input['id'] ?? null);

		$repository = ServiceContainer::get(Repository::class);

		if (0 === $repository->deleteTodo($id)) {
			throw new ValidationException('待办不存在', 400);
		}

		return success('已删除待办');
	}
}
