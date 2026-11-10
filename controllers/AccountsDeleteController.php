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

class AccountsDeleteController implements ControllerInterface
{
	/**
	 * POST /api/accounts/delete
	 *
	 * 批量删除：`{ ids: [1,2,3] }`。接口用 POST 而不是 DELETE，与
	 * /api/items/delete、/api/skills/delete 保持一致（DELETE 带请求体在部分代理上会被丢）。
	 *
	 * 授权记录与「通过哪个账号登录」的悬空引用由 Repository::deleteAccounts()
	 * 在同一个事务里清理，控制器只负责参数与响应。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$ids = AccountPayload::parseIds($input);
		$deleted = $repository->deleteAccounts($ids);

		// 一条都没删掉说明这些 id 已经不存在：按 PRD §8.3「无效 id 返回 404」处理，
		// 否则重复删除会静默成功，前端无法发现自己的列表已经过期。
		if ($deleted <= 0) {
			throw new NotFoundException('账号不存在');
		}

		return success("已删除 {$deleted} 个账号", [
			'deleted' => $deleted,
			'ids' => $ids,
		]);
	}
}
