<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\TodoPayload;
use function Framework\success;

class TodosPatchController implements ControllerInterface
{
	/**
	 * PATCH /api/todos（PRD docs/prd/todo.md §5.5 / §6.2）
	 *
	 * 只接受 `{ id, done }` 且只允许切换完成状态：done=true 由服务端写 done_at，
	 * done=false 时 Repository 会把 done_at 置回 NULL。首版不支持编辑文字，
	 * 请求里带 text 一律 400，避免前端误以为改文字生效（PRD §5.6 明确删除重写）。
	 *
	 * id 不存在同样返回 400「待办不存在」（PRD §6.2 统一口径）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		if (array_key_exists('text', $input)) {
			throw new ValidationException('待办不支持修改文字，请删除后重新添加', 400);
		}

		$id = TodoPayload::parseId($input['id'] ?? null);
		$done = TodoPayload::parseDone($input['done'] ?? null);

		$repository = ServiceContainer::get(Repository::class);

		$todo = $repository->updateTodoDone($id, $done);

		if (!$todo) {
			throw new ValidationException('待办不存在', 400);
		}

		return success('已更新待办', [
			'todo' => TodoPayload::formatTodo($todo),
		]);
	}
}
