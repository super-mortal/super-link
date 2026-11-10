<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AccountPayload;
use Utils\VaultMetaPayload;
use function Framework\success;

class AccountsUpdateController implements ControllerInterface
{
	/**
	 * PATCH /api/accounts
	 *
	 * 部分更新：未传的字段一律不动（见 AccountPayload::parseUpdate 的注释）。
	 * 账号库是单字段加密（PRD §6.5），正因为如此才能做到「只改备注不动密码密文」。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$id = AccountPayload::parseId($input['id'] ?? null);

		if (!$repository->getAccountById($id)) {
			throw new NotFoundException('账号不存在');
		}

		$payload = AccountPayload::parseUpdate($input);
		AccountPayload::assertRelationsExist($repository, $payload);

		// 只有真的提交了新的密码密文才刷新 password_updated_at。
		// 改备注、换分组、点收藏都不代表密码变了；如果每次都刷成今天，
		// 「密码最久未改」这个排序就失去意义，用户也没法判断什么时候该换密码。
		// 显式传 null（清空密码）同样不算改密，保持原值。
		if (array_key_exists('password_ct', $payload) && null !== $payload['password_ct']) {
			$payload['password_updated_at'] = date('Y-m-d');
		}

		if (!$repository->updateAccount($id, $payload)) {
			throw new DataWriteException('账号更新失败，请稍后重试');
		}

		$row = $repository->getAccountById($id);

		if (!$row) {
			throw new NotFoundException('账号不存在');
		}

		$group = null;
		if (isset($row['group_id'])) {
			$group_row = $repository->getAccountGroupById((int)$row['group_id']);
			$group = isset($group_row['name']) ? (string)$group_row['name'] : null;
		}

		return success('账号更新成功', ['account' => AccountPayload::formatAccount($row, $group)]);
	}
}
