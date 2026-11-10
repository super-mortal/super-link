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

class VaultSetupController implements ControllerInterface
{
	/**
	 * POST /api/vault/setup
	 *
	 * 首次初始化账号库：保存 KDF 参数、盐、被包裹的 DEK。服务端只存密文，不参与加解密。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);

		// 已初始化必须拒绝：setup 会写入新的 wrapped_dek，一旦覆盖，旧 DEK 再也取不回来，
		// 账号库里的密文会永久无法解密。换主密码走 change-master，重建走 reset。
		if ($repository->getVaultMeta()) {
			throw new ValidationException('账号库已初始化，不能重复设置主密码', 409);
		}

		$payload = VaultMetaPayload::parse($input);

		if (!$repository->createVaultMeta($payload)) {
			throw new DataWriteException('账号库初始化失败，请稍后重试');
		}

		return success('账号库初始化成功', [
			'initialized' => true,
			'version' => $payload['version'],
			'kdf' => $payload['kdf'],
		]);
	}
}
