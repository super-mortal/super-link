<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AccountPayload;
use Utils\VaultMetaPayload;
use function Framework\success;

class AccountGroupsGetController implements ControllerInterface
{
	/**
	 * GET /api/account-groups（refinements-v0.1.2 §3.2）
	 *
	 * 账号分组字典列表（含每组账号数量），供设置页「分组」分区使用。
	 * 计数由仓储层 LEFT JOIN accounts 得出：为 0 的分组也返回，设置页需要展示
	 * 并允许删除。字典规模小，total 直接取返回条数，不再单独查 COUNT。
	 *
	 * 与其它账号端点一致：账号库未初始化时返回 409「请先设置主密码」，
	 * 避免前端把「没分组」误判成字典为空。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 账号库响应统一 no-store（PRD §7.5），与其它账号端点保持一致
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$groups = array_map(
			fn(array $row): array => AccountPayload::formatAccountGroup($row),
			$repository->getAccountGroupsWithCounts()
		);

		return success('获取账号分组成功', [
			'groups' => $groups,
			'total' => count($groups),
		]);
	}
}
