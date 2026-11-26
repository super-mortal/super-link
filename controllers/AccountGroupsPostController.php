<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AccountPayload;
use Utils\VaultMetaPayload;
use function Framework\success;

class AccountGroupsPostController implements ControllerInterface
{
	/**
	 * POST /api/account-groups（refinements-v0.1.2 §3.2）
	 *
	 * body `{ name }`：新增账号分组字典项。名称先去首尾空格，空名 400，
	 * 重名 400「分组「x」已存在」——先查后插给出中文提示，name 的 UNIQUE
	 * 约束只作为并发竞态兜底（Repository::createAccountGroup 注释同款口径）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 账号库响应统一 no-store（PRD §7.5），与其它账号端点保持一致
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$name = AccountPayload::parseGroupName($input['name'] ?? null);

		if ($repository->getAccountGroupByName($name)) {
			throw new ValidationException("分组「{$name}」已存在", 400);
		}

		$id = $repository->createAccountGroup($name);

		if ($id <= 0) {
			throw new DataWriteException('分组创建失败，请稍后重试');
		}

		$row = $repository->getAccountGroupById($id);

		if (!$row) {
			throw new NotFoundException('分组不存在');
		}

		// 新分组必然没有账号，count 为 0（getAccountGroupById 不带计数列）
		return success('分组创建成功', [
			'group' => AccountPayload::formatAccountGroup($row),
		]);
	}
}
