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

class AccountsAuthorizationsUpdateController implements ControllerInterface
{
	/**
	 * POST /api/accounts/authorizations/update
	 *
	 * 部分更新（PATCH 语义）：只处理请求里出现的字段，未传的列保持原值。
	 *
	 * 为什么单独开 /update 子路径，而不是让 create 端点兼做 upsert：
	 * upsert 只能靠「有没有 id」猜调用者意图，「新增授权」和「编辑授权」是两个独立弹窗，
	 * 一旦弹窗里残留了 id 就会静默改写别的授权。分开端点后路径即语义，误调用直接 404/400，
	 * 也不会出现「本以为是新建、结果覆盖了历史记录」这种难以察觉的数据损失。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$id = AccountPayload::parseAuthorizationId($input['id'] ?? null);
		$current = $repository->getAuthorizationById($id);

		if (!$current) {
			throw new NotFoundException('授权记录不存在');
		}

		$payload = AccountPayload::parseAuthorizationUpdate($input);

		if (empty($payload)) {
			throw new ValidationException('没有需要更新的字段', 400);
		}

		// 自环校验必须基于「合并后的有效值」：只传 account_id 或只传 linked_account_id
		// 都可能拼出 A→A，所以把原记录一并传进去，由 AccountPayload 合并后再判断。
		AccountPayload::assertAuthorizationReferences($repository, $payload, $current);

		if (!$repository->updateAuthorization($id, $payload)) {
			throw new DataWriteException('授权更新失败，请稍后重试');
		}

		$row = $repository->getAuthorizationById($id);

		if (!$row) {
			throw new NotFoundException('授权记录不存在');
		}

		return success('授权更新成功', ['authorization' => AccountPayload::formatAuthorization($row)]);
	}
}
