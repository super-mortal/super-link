<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\BackupPayload;
use Utils\ServerBackupRestorer;
use function Framework\success;

/**
 * POST /api/backup/servers/restore
 *
 * 服务器恢复（refinements.md §4.3 / §4.4 / §4.5 / dev-spec §6.4、§6.5）：
 * multipart 字段 file（必填）+ mode=merge|overwrite（默认 merge）+ dry_run（1/true 为预检）。
 *
 * 恢复把备份里的 token_hash / token_salt 原样写回 servers 表（Hub 地址不变时
 * agent 无需重装），因此备份文件等同凭据材料：
 *   - 响应只回 { dry_run, mode, note, removed, summary, groups_created, items }
 *     （预检按 refinements.md §4.5 扁平化为 { new, updated, same, skipped, failed, ... }），
 *     逐条只含 name / status / message，绝不回显哈希与盐（用户态白名单在 ServerPayload）；
 *     groups_created 为本次（或将）自动新建的字典外分组数（refinements-v0.1.2 §3.4）；
 *   - 本控制器不写日志，错误信息也不带凭据字段；
 *   - 依赖框架默认登录态与 CSRF 校验，不加入任何认证 / CSRF / migrate 跳过名单。
 *
 * 校验失败统一 400（ValidationException 显式带 400），在 ServerBackupRestorer::parse()
 * 阶段拦截；dry_run 只读现有服务器做分类，不写库、不删除。
 *
 * 执行走单事务（在恢复器内部）：任何一步失败整体回滚，包括覆盖模式对备份外
 * 服务器的删除，不留半恢复状态。
 */
class BackupServersRestoreController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// multipart 请求由 Application::getInput() 合并 $_POST / $_GET / $_FILES，
		// 所以文件信息在 $input['file']（与其它备份恢复端点同一取法）
		$file = $input['file'] ?? null;
		if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
			throw new ValidationException('请选择要恢复的备份文件', 400);
		}

		$tmpName = $file['tmp_name'] ?? '';
		$content = $tmpName !== '' ? file_get_contents($tmpName) : false;
		if ($content === false) {
			throw new ValidationException('无法读取上传的文件', 400);
		}

		$mode = (string)($input['mode'] ?? ServerBackupRestorer::MODE_MERGE);
		// FILTER_VALIDATE_BOOLEAN 认 '1' / 'true' / 'on' / 'yes'，未传时按 false 处理
		$dryRun = filter_var($input['dry_run'] ?? false, FILTER_VALIDATE_BOOLEAN);

		$repository = ServiceContainer::get(Repository::class);
		// 事务边界在恢复器内部：与 Repository 共用同一个 PDO 连接（见 init.php 的绑定），
		// deleteServer() 才能感知到外层事务、不会重复 beginTransaction
		$restorer = new ServerBackupRestorer($repository, ServiceContainer::get(\PDO::class));

		// 新端点严格校验 module / version / 字段：任何格式问题都在这里 400，
		// 预检与执行都不会写库
		$payload = $restorer->parse($content);
		$result = $restorer->restore($payload, $mode, $dryRun);

		$summary = $result['summary'];
		if ($dryRun) {
			$message = "预检完成：新增 {$summary['new']} 台，同名 {$summary['same']} 台，跳过 {$summary['skipped']} 台";
			if ($result['removed'] > 0) {
				$message .= "，将删除备份外 {$result['removed']} 台";
			}
		} else {
			$message = "恢复完成：新增 {$summary['new']} 台，更新 {$summary['updated']} 台，跳过 {$summary['skipped']} 台";
			if ($result['removed'] > 0) {
				$message .= "，已清理备份外 {$result['removed']} 台";
			}
		}

		return success($message, $dryRun ? BackupPayload::flattenPreview($result) : $result);
	}
}
