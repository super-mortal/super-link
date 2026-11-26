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

class AccountGroupsDeleteController implements ControllerInterface
{
	/**
	 * POST /api/account-groups/delete（refinements-v0.1.2 §3.2）
	 *
	 * body `{ id }`：删除账号分组。用 POST 而不是 DELETE，与 items / accounts /
	 * skills / servers 的删除端点一致（带请求体的 DELETE 在部分代理上会被丢）。
	 *
	 * 两道守卫：
	 * 1. 非空分组 400「分组「x」下还有 N 个账号，请先移出后再删除」——本项目
	 *    连接未开启 PRAGMA foreign_keys，accounts 建表声明的 ON DELETE SET NULL
	 *    不会触发，必须在应用层拦截，否则会留下悬空 group_id；
	 * 2. 至少保留一个分组（只剩一个时 400）——新增账号要用 sort 最小的分组做
	 *    缺省值，字典清空后没有落点。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 账号库响应统一 no-store（PRD §7.5），与其它账号端点保持一致
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$id = AccountPayload::parseGroupId($input['id'] ?? $input['group-id'] ?? null);

		$group = $repository->getAccountGroupById($id);

		if (!$group) {
			throw new NotFoundException('分组不存在');
		}

		$name = (string)$group['name'];
		$account_count = $repository->countAccountsInGroup($id);

		if ($account_count > 0) {
			throw new ValidationException("分组「{$name}」下还有 {$account_count} 个账号，请先移出后再删除", 400);
		}

		if ($repository->countAccountGroups() <= 1) {
			throw new ValidationException('至少保留一个分组，无法删除最后一个分组', 400);
		}

		// 删除期间若被并发删掉，rowCount 为 0：按 404 处理，避免前端以为删成功了
		if (!$repository->deleteAccountGroup($id)) {
			throw new NotFoundException('分组不存在');
		}

		return success('分组删除成功', [
			'id' => $id,
			'name' => $name,
		]);
	}
}
