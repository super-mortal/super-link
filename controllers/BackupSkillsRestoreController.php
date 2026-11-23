<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\BackupPayload;
use Utils\SkillBackupRestorer;
use Utils\SkillInstaller;
use function Framework\success;

/**
 * POST /api/backup/skills/restore
 *
 * Skill 恢复（refinements.md §4.3 / dev-spec §6.3、§6.5）：
 * multipart 字段 file（必填）+ mode=merge|overwrite（默认 merge）+ dry_run（1/true 为预检）。
 *
 * 恢复不复制文件：按备份里的 source_url 重新走 GitHub 安装流程拉取最新版本
 * （同名 github 更新、缺失安装、同名 upload 跳过）。因此执行阶段依赖外部 GitHub，
 * 单条不可达 / URL 非法只记该条 failed，不中断其余条目；dry_run 只读本地状态，
 * 不触发 clone / fetch / 写库 / 删文件。
 *
 * 响应走 success($message, $result)：
 *   - 预检（dry_run）按 refinements.md §4.5 返回扁平 `{ dry_run, mode, new, updated, same, skipped, items, note }`；
 *   - 执行返回 `{ dry_run, mode, note, summary: { new, updated, same, skipped, failed }, items }`。
 * 逐条结果只含名称与状态（失败原因可能带 SkillInstaller 的 [SL-XXX-NNNN] 错误码），
 * 不回显任何敏感字段。
 *
 * 安全：写操作依赖框架默认的登录态与 CSRF 校验，不加入任何跳过名单；
 * 校验失败统一 400（ValidationException 显式带 400，而不是默认 422），
 * 且在 SkillBackupRestorer::parse() 阶段拦截，预检 / 执行都不会写库。
 */
class BackupSkillsRestoreController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// multipart 请求由 Application::getInput() 合并 $_POST / $_GET / $_FILES，
		// 所以文件信息在 $input['file']（与 BackupBookmarksRestoreController 同一取法）
		$file = $input['file'] ?? null;
		if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
			throw new ValidationException('请选择要恢复的备份文件', 400);
		}

		$tmpName = $file['tmp_name'] ?? '';
		$content = $tmpName !== '' ? file_get_contents($tmpName) : false;
		if ($content === false) {
			throw new ValidationException('无法读取上传的文件', 400);
		}

		$mode = (string)($input['mode'] ?? SkillBackupRestorer::MODE_MERGE);
		// FILTER_VALIDATE_BOOLEAN 认 '1' / 'true' / 'on' / 'yes'，未传时按 false 处理
		$dryRun = filter_var($input['dry_run'] ?? false, FILTER_VALIDATE_BOOLEAN);

		$repository = ServiceContainer::get(Repository::class);
		$restorer = new SkillBackupRestorer($repository, new SkillInstaller($repository));

		// 新端点严格校验 module / version / 字段：任何格式问题都在这里 400，
		// 不会进入安装分支（与旧 /api/import/data 的默认值适配层区分开）
		$payload = $restorer->parse($content);
		$result = $restorer->restore($payload, $mode, $dryRun);

		if ($dryRun) {
			$message = "预检完成：待安装 {$result['summary']['new']} 个，同名 {$result['summary']['same']} 个，跳过 {$result['summary']['skipped']} 个";
		} else {
			$message = "恢复完成：新装 {$result['summary']['new']} 个，更新 {$result['summary']['updated']} 个，跳过 {$result['summary']['skipped']} 个";
			if ($result['summary']['failed'] > 0) {
				$message .= "，失败 {$result['summary']['failed']} 个";
			}
		}

		return success($message, $dryRun ? BackupPayload::flattenPreview($result) : $result);
	}
}
