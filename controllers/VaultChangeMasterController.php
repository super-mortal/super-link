<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\VaultMetaPayload;
use function Framework\success;

class VaultChangeMasterController implements ControllerInterface
{
	/**
	 * POST /api/vault/change-master
	 *
	 * 更换主密码：用新主密码派生 KEK，重新包裹同一把 DEK，覆盖 KDF 参数、盐与 wrapped_dek。
	 *
	 * 服务端不校验旧主密码：按 PRD §7.5 不提供「验证主密码」接口，避免离线爆破入口；
	 * 旧密码是否正确由前端解密旧 wrapped_dek 是否成功（GCM 校验失败即密码错误）决定。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);

		// 没有元信息就没有 DEK，改密无从谈起，提示先初始化
		if (!$repository->getVaultMeta()) {
			throw new ValidationException('账号库尚未初始化，请先设置主密码', 400);
		}

		$payload = VaultMetaPayload::parse($input);

		if (!$repository->updateVaultMeta($payload)) {
			throw new DataWriteException('主密码更新失败，请稍后重试');
		}

		return success('主密码已更新，请使用新主密码解锁账号库', [
			'initialized' => true,
			'version' => $payload['version'],
			'kdf' => $payload['kdf'],
		]);
	}
}
