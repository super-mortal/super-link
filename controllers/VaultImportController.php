<?php

namespace Controllers;

use Exception;
use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\VaultBackupPayload;
use Utils\VaultMetaPayload;
use function Framework\success;

class VaultImportController implements ControllerInterface
{
	/** 允许的导入模式：merge 合并（默认）/ replace 覆盖 */
	private const MODES = ['merge', 'replace'];

	/**
	 * POST /api/vault/import
	 *
	 * 导入加密备份 .slvault（PRD §8.1）。上传方式与 Skill 上传 / 书签导入保持一致：
	 * multipart 表单，file 字段放备份文件，mode 字段放导入模式。
	 *
	 * 「需主密码解密校验后合并/覆盖」（PRD §8.1）这一步在浏览器完成：
	 * 前端用文件里的 salt + KDF 参数派生 KEK，尝试解包 wrapped_dek，GCM 校验失败
	 * 即密码错误或文件损坏，根本不会走到本控制器。服务端没有密钥，不提供也
	 * 不该提供「验证主密码」接口（PRD §7.5：避免额外的离线爆破入口）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$file = $input['file'] ?? null;
		if (!is_array($file) || !isset($file['tmp_name']) || UPLOAD_ERR_OK !== ($file['error'] ?? null)) {
			throw new ValidationException('未上传文件或上传失败', 400);
		}

		$extension = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
		if ('slvault' !== $extension) {
			throw new ValidationException('请选择 .slvault 格式的加密备份文件', 400);
		}

		$content = file_get_contents($file['tmp_name']);
		if (false === $content || '' === $content) {
			throw new ValidationException('无法读取上传的文件', 400);
		}

		$decoded = json_decode($content, true);
		if (!is_array($decoded)) {
			throw new ValidationException('备份文件不是有效的 JSON，可能已损坏', 400);
		}

		$backup = VaultBackupPayload::parse($decoded);

		$mode = (string)($input['mode'] ?? 'merge');
		if (!in_array($mode, self::MODES, true)) {
			throw new ValidationException('导入模式不正确，仅支持 merge 或 replace', 400);
		}

		$repository = ServiceContainer::get(Repository::class);

		// merge 的密钥一致性校验：备份里的密文是用**备份的 DEK** 加密的，只有两边
		// wrapped_dek 相同才说明是同一把 DEK，合并后导入的账号在本地才解得开。
		// 否则本地账号与导入账号各用各的 DEK，导入的账号会变成永远解不开的死数据，
		// 因此直接拒绝并提示改用 replace（覆盖导入整体换成备份的密钥体系）。
		if ('merge' === $mode) {
			$meta = $repository->getVaultMeta();
			if ($meta && !$this->sameWrappedDek($meta, $backup['meta']['wrapped_dek'])) {
				throw new ValidationException(
					'备份与当前账号库不是同一把数据密钥，合并导入会导致导入的账号无法解密；如需导入该备份，请改用「覆盖」模式',
					400
				);
			}
		}

		try {
			$result = $repository->importVaultBackup($backup, $mode);
		} catch (ValidationException $e) {
			throw $e;
		} catch (Exception $e) {
			// 走到这里说明写入中途失败，Repository 已回滚；不暴露底层异常细节
			throw new DataWriteException('导入失败，数据已回滚，请稍后重试', 500, $e);
		}

		$message = "导入成功：{$result['accounts']} 个账号、{$result['authorizations']} 条授权关系";
		if ($result['skipped_accounts'] > 0) {
			$message .= "，{$result['skipped_accounts']} 个账号因 id 已存在被跳过";
		}
		if ($result['skipped_authorizations'] > 0) {
			$message .= "，{$result['skipped_authorizations']} 条授权因 id 已存在被跳过";
		}

		return success($message, [
			'mode' => $mode,
			'accounts' => $result['accounts'],
			'skipped_accounts' => $result['skipped_accounts'],
			'authorizations' => $result['authorizations'],
			'skipped_authorizations' => $result['skipped_authorizations'],
		]);
	}

	/**
	 * 比较库里的 wrapped_dek 与备份文件里解码后的 wrapped_dek
	 *
	 * BLOB 列在个别 PDO 配置下返回流资源而不是字符串（见 VaultMetaPayload::encodeBlob），
	 * 先归一为字符串再比较。wrapped_dek 本身不是秘密（meta 接口与备份文件里都有），
	 * 这里用普通比较即可，目的是判断「是不是同一把 DEK」而不是保密。
	 */
	private function sameWrappedDek(array $meta, string $backup_wrapped_dek): bool
	{
		$local = $meta['wrapped_dek'];
		if (is_resource($local)) {
			$local = stream_get_contents($local);
		}

		return (string)$local === $backup_wrapped_dek;
	}
}
