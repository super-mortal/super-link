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

class AccountsAuthorizationsDeleteController implements ControllerInterface
{
	/**
	 * POST /api/accounts/authorizations/delete
	 *
	 * `{ id: 1 }` 删除单条；`{ ids: [1,2] }` 支持批量（与 /api/accounts/delete 一致）。
	 * 用 POST 而不是 DELETE，同样是因为带请求体的 DELETE 在部分代理上会被丢。
	 *
	 * 返回实际删除条数。所有 id 都不存在时按 PRD §8.3「无效 id 返回 404」处理：
	 * 静默成功会让前端以为删掉了，列表却还在。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$ids = AccountPayload::parseAuthorizationIds($input);

		// 先统一确认存在再删：边删边报错会留下「删了一半又返回 404」的半成品状态，
		// 前端无法判断到底哪几条已经没了。
		foreach ($ids as $id) {
			if (!$repository->getAuthorizationById($id)) {
				throw new NotFoundException('授权记录不存在');
			}
		}

		$deleted = 0;

		foreach ($ids as $id) {
			// PDO::execute() 对「0 行受影响」同样返回 true，所以条数只能靠上面的存在性预检
			// 配合这里逐个计数得出，不能直接用 rowCount 之外的东西去猜。
			if ($repository->deleteAuthorization($id)) {
				$deleted++;
			}
		}

		return success("已删除 {$deleted} 条授权记录", [
			'deleted' => $deleted,
			'ids' => $ids,
		]);
	}
}
