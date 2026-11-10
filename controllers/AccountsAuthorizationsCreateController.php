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

class AccountsAuthorizationsCreateController implements ControllerInterface
{
	/**
	 * POST /api/accounts/authorizations
	 *
	 * 新建授权关系（PRD §6.4 / §8.2 / §10.4）。
	 *
	 * 授权字段本身是明文元数据：站点名、站点账号、备注、授权日期描述的是
	 * 「这个账号在哪个站点上用哪个身份登录」，不包含任何凭据。PRD §7 的加密边界
	 * 只覆盖密码 / TOTP / 备注密文，授权表按设计明文存储——加密会让服务端无法
	 * 按站点筛选、前端也无法渲染双列卡片与「关联账号」跳转（PRD §10.5）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		$payload = AccountPayload::parseAuthorizationCreate($input);

		// 本项目的 SQLite 连接没开 PRAGMA foreign_keys，悬空外键不会报错只留脏引用，
		// 因此 account_id / linked_account_id 的存在性与「不能指向自己」必须显式校验。
		AccountPayload::assertAuthorizationReferences($repository, $payload);

		$id = $repository->createAuthorization($payload);

		if ($id <= 0) {
			throw new DataWriteException('授权创建失败，请稍后重试');
		}

		// 回读一次再返回：created_at / updated_at 由服务端写入，前端拿到的必须与库里一致
		$row = $repository->getAuthorizationById($id);

		if (!$row) {
			throw new NotFoundException('授权记录不存在');
		}

		return success('授权创建成功', ['authorization' => AccountPayload::formatAuthorization($row)]);
	}
}
