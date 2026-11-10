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

class AccountsCreateController implements ControllerInterface
{
	/**
	 * POST /api/accounts
	 *
	 * 只接收元数据 + 客户端加密后的密文（PRD §6.5 / §7.5）：服务端不参与加解密，
	 * 也没有密钥可用来校验明文，因此这里既不会、也不应该看到密码原文。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$payload = AccountPayload::parseCreate($input);
		AccountPayload::assertRelationsExist($repository, $payload);

		$id = $repository->createAccount($payload);

		if ($id <= 0) {
			throw new DataWriteException('账号创建失败，请稍后重试');
		}

		// 回读一次再返回：created_at / updated_at / password_updated_at 都由服务端写入，
		// 前端拿到的必须与库里一致，避免自己猜日期导致列表排序错乱。
		$row = $repository->getAccountById($id);

		if (!$row) {
			throw new NotFoundException('账号不存在');
		}

		$group = null;
		if (isset($row['group_id'])) {
			$group_row = $repository->getAccountGroupById((int)$row['group_id']);
			$group = isset($group_row['name']) ? (string)$group_row['name'] : null;
		}

		return success('账号创建成功', ['account' => AccountPayload::formatAccount($row, $group)]);
	}
}
