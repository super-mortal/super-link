<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Utils\BookmarkRestorer;
use function Framework\success;

/**
 * POST /api/backup/bookmarks/restore
 *
 * 书签恢复（refinements.md §4.3 / dev-spec §6.5）：
 * multipart 字段 file（必填）+ mode=merge|overwrite（默认 merge）+ dry_run（1/true 为预检）。
 *
 * 响应走 success($message, $result)，result 为
 * { dry_run, mode, summary: { new, same, skipped, failed }, items, tags }；
 * 逐条结果只含 URL 名称与状态，不回显任何敏感字段。
 *
 * 安全：写操作依赖框架默认的登录态与 CSRF 校验，不加入任何跳过名单；
 * 校验失败统一 400（ValidationException 显式带 400，而不是默认 422），
 * 且在 BookmarkRestorer::parse() 阶段拦截，预检 / 执行都不会写库。
 */
class BackupBookmarksRestoreController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// multipart 请求由 Application::getInput() 合并 $_POST / $_GET / $_FILES，
		// 所以文件信息在 $input['file']（与 SkillsUploadController 同一取法）
		$file = $input['file'] ?? null;
		if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
			throw new ValidationException('请选择要恢复的备份文件', 400);
		}

		$tmpName = $file['tmp_name'] ?? '';
		$content = $tmpName !== '' ? file_get_contents($tmpName) : false;
		if ($content === false) {
			throw new ValidationException('无法读取上传的文件', 400);
		}

		$mode = (string)($input['mode'] ?? BookmarkRestorer::MODE_MERGE);
		// FILTER_VALIDATE_BOOLEAN 认 '1' / 'true' / 'on' / 'yes'，未传时按 false 处理
		$dryRun = filter_var($input['dry_run'] ?? false, FILTER_VALIDATE_BOOLEAN);

		$restorer = new BookmarkRestorer(ServiceContainer::get(\PDO::class));

		// 新端点严格校验 module：备份文件缺 module 一律 400（与旧 /api/import/data
		// 的默认值适配层区分开，见 ImportDataController 注释）
		$payload = $restorer->parse($content);
		$result = $restorer->restore($payload, $mode, $dryRun);

		if ($dryRun) {
			$message = "预检完成：新增 {$result['summary']['new']} 条，同名 {$result['summary']['same']} 条";
		} else {
			$message = "恢复完成：新增 {$result['summary']['new']} 条，跳过 {$result['summary']['same']} 条";
			if ($result['summary']['failed'] > 0) {
				$message .= "，失败 {$result['summary']['failed']} 条";
			}
		}

		return success($message, $result);
	}
}
