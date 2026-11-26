<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AccountPayload;
use Utils\VaultMetaPayload;
use function Framework\success;

class AccountGroupsPatchController implements ControllerInterface
{
	/**
	 * PATCH /api/account-groups（refinements-v0.1.2 §3.2）
	 *
	 * body `{ id, name }`：重命名账号分组。不存在 404，重名 400。
	 * 只改字典行：accounts.group_id 按 id 关联，名称变化无需级联更新
	 * （与服务器分组按名称存分组的方式不同）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 账号库响应统一 no-store（PRD §7.5），与其它账号端点保持一致
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$id = AccountPayload::parseGroupId($input['id'] ?? $input['group-id'] ?? null);
		$name = AccountPayload::parseGroupName($input['name'] ?? null);

		$group = $repository->getAccountGroupById($id);

		if (!$group) {
			throw new NotFoundException('分组不存在');
		}

		$old_name = (string)$group['name'];

		// 改成同名视为成功（幂等）：设置页允许原样提交表单，用户没有实际改动时
		// 报「分组已存在」会让人以为操作失败；直接返回当前分组，且不触发多余的写库。
		if ($old_name === $name) {
			$group['count'] = $repository->countAccountsInGroup($id);
			return success('分组更新成功', [
				'group' => AccountPayload::formatAccountGroup($group),
			]);
		}

		$existing = $repository->getAccountGroupByName($name);

		if ($existing && (int)$existing['id'] !== $id) {
			throw new ValidationException("分组「{$name}」已存在", 400);
		}

		if (!$repository->renameAccountGroup($id, $name)) {
			throw new NotFoundException('分组不存在');
		}

		$row = $repository->getAccountGroupById($id);

		if (!$row) {
			throw new NotFoundException('分组不存在');
		}

		// 重命名只换名称、不改成员集合：按 id 计数即新名称下的账号数
		$row['count'] = $repository->countAccountsInGroup($id);

		return success('分组更新成功', [
			'group' => AccountPayload::formatAccountGroup($row),
		]);
	}
}
