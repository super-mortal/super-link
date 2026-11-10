<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AccountPayload;
use Utils\VaultMetaPayload;
use function Framework\success;

class AccountsDetailGetController implements ControllerInterface
{
	/**
	 * GET /api/accounts/detail?id=
	 *
	 * 详情 = 元数据 + 密文 + 授权关系（PRD §8.2 示例）。
	 * 依旧不返回任何明文：解密只发生在浏览器里，服务端连 DEK 都没有，想做也做不到。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$id = AccountPayload::parseId($input['id'] ?? null);
		$row = $repository->getAccountById($id);

		if (!$row) {
			throw new NotFoundException('账号不存在');
		}

		$group = null;
		if (isset($row['group_id'])) {
			$group_row = $repository->getAccountGroupById((int)$row['group_id']);
			$group = isset($group_row['name']) ? (string)$group_row['name'] : null;
		}

		$account = AccountPayload::formatAccount($row, $group);
		$account['authorizations'] = array_map(
			[AccountPayload::class, 'formatAuthorization'],
			$repository->getAuthorizationsByAccountId($id)
		);

		return success('获取账号详情成功', ['account' => $account]);
	}
}
