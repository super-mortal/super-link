<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\VaultMetaPayload;
use function Framework\success;

class VaultMetaGetController implements ControllerInterface
{
	/**
	 * GET /api/vault/meta
	 *
	 * 只返回 KDF 参数与密文（base64），永远不返回任何账号明文：
	 * 前端用它判断是否需要「设置主密码」，解锁时再用 salt + KDF 参数派生 KEK 去解 wrapped_dek。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		$meta = $repository->getVaultMeta();

		// 未初始化不是错误：前端据此展示「设置主密码」，所以返回 200 + initialized=false。
		// 其余字段统一给 null（而不是省略或空串），前端只需判断 initialized 一种状态。
		if (!$meta) {
			return success('账号库尚未初始化', [
				'initialized' => false,
				'version' => null,
				'kdf' => null,
				'kdf_memory' => null,
				'kdf_iterations' => null,
				'kdf_parallelism' => null,
				'salt' => null,
				'wrapped_dek' => null,
				'wrap_nonce' => null,
				'created_at' => null,
				'updated_at' => null,
			]);
		}

		return success('获取账号库元信息成功', [
			'initialized' => true,
			'version' => (int)$meta['version'],
			'kdf' => $meta['kdf'],
			'kdf_memory' => (int)$meta['kdf_memory'],
			'kdf_iterations' => (int)$meta['kdf_iterations'],
			'kdf_parallelism' => (int)$meta['kdf_parallelism'],
			'salt' => VaultMetaPayload::encodeBlob($meta['kdf_salt']),
			'wrapped_dek' => VaultMetaPayload::encodeBlob($meta['wrapped_dek']),
			'wrap_nonce' => VaultMetaPayload::encodeBlob($meta['wrap_nonce']),
			'created_at' => $meta['created_at'],
			'updated_at' => $meta['updated_at'],
		]);
	}
}
