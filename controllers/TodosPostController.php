<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\TodoPayload;
use function Framework\success;

class TodosPostController implements ControllerInterface
{
	/**
	 * POST /api/todos（PRD docs/prd/todo.md §5.2 / §6.2）
	 *
	 * 入参只有 `{ text }`：trim / 非空 / ≤200 字符由 TodoPayload::parseText()
	 * 校验并抛 400；created_at / updated_at 由服务端写入，前端不传也不接受。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$text = TodoPayload::parseText($input['text'] ?? null);

		$repository = ServiceContainer::get(Repository::class);

		$todo = $repository->createTodo($text);

		if (!$todo) {
			throw new DataWriteException('待办保存失败，请稍后重试');
		}

		return success('已添加待办', [
			'todo' => TodoPayload::formatTodo($todo),
		]);
	}
}
