<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AccountPayload;
use Utils\VaultMetaPayload;
use function Framework\data;

class VaultExportController implements ControllerInterface
{
	/**
	 * GET /api/vault/export
	 *
	 * 导出加密备份 .slvault（PRD §8.1）：KDF 元信息 + 全部账号（元数据 + 密文 + 授权关系）。
	 *
	 * 文件内没有任何明文：服务端只搬运客户端加密后的 {ct, iv}，连 DEK 都没有，
	 * 想做明文也做不到（PRD §7.4 / §7.5）。备份的安全性完全由主密码保证——
	 * 拿到文件的人没有主密码就无法解出任何账号。
	 *
	 * 响应形态说明：这里返回**裸 JSON**（不是 success 包裹），因为响应体本身就是
	 * 备份文件内容——直接访问端点存盘、前端 fetch 后存盘，两种用法拿到的字节一致。
	 * 出错时仍走框架统一异常格式 { success: false, message, error }。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		$meta = $repository->getVaultMeta();

		// 未初始化：没有 KDF 参数与 wrapped_dek，导出的文件没有解密线索，等于废文件
		if (!$meta) {
			throw new ValidationException('账号库尚未初始化，请先设置主密码', 400);
		}

		// 授权关系按 account_id 预分组：导出结构是「一条账号带其授权」（与详情接口一致），
		// 一次查全量再在内存分组，避免逐账号 N+1 查询
		$authorizations_by_account = [];
		foreach ($repository->getAllAuthorizations() as $authorization) {
			$authorizations_by_account[(int)$authorization['account_id']][] = $authorization;
		}

		$group_names = [];
		foreach ($repository->getAccountGroups() as $group) {
			$group_names[(int)$group['id']] = (string)$group['name'];
		}

		$accounts = [];
		foreach ($repository->getAccounts()['accounts'] as $row) {
			$account = AccountPayload::formatAccount(
				$row,
				$group_names[(int)($row['group_id'] ?? 0)] ?? null
			);
			$account['authorizations'] = array_map(
				[AccountPayload::class, 'formatAuthorization'],
				$authorizations_by_account[(int)$row['id']] ?? []
			);
			$accounts[] = $account;
		}

		// 下载头：直接访问端点时浏览器存成 .slvault 文件（PRD §8.1 规定的 YYYYMMDD 日期格式）。
		// DataResponse 已负责 Content-Type: application/json 与 Cache-Control: no-store。
		header('Content-Disposition: attachment; filename="super-link-vault-' . date('Ymd') . '.slvault"');

		return data([
			'version' => (int)$meta['version'],
			'exported_at' => date('c'),
			'kdf' => $meta['kdf'],
			'kdf_memory' => (int)$meta['kdf_memory'],
			'kdf_iterations' => (int)$meta['kdf_iterations'],
			'kdf_parallelism' => (int)$meta['kdf_parallelism'],
			'salt' => VaultMetaPayload::encodeBlob($meta['kdf_salt']),
			'wrapped_dek' => VaultMetaPayload::encodeBlob($meta['wrapped_dek']),
			'wrap_nonce' => VaultMetaPayload::encodeBlob($meta['wrap_nonce']),
			'accounts' => $accounts,
		]);
	}
}
