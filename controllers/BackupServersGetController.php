<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\BackupPayload;
use function Framework\data;

class BackupServersGetController implements ControllerInterface
{
	/**
	 * GET /api/backup/servers
	 *
	 * 服务器模块 JSON 备份（refinements.md §4.2 / dev-spec §6.4）：
	 * { module: 'servers', version, exported_at, servers: [...] }
	 *
	 * 字段白名单：name / note / group / paused / token_hash / token_salt。
	 * 对外字段名用 group（内部列名 group_name），group_id 不导出（dev-spec §6.4）；
	 * 不含 server_metrics / server_disks / server_docker 与任何运行态——历史数据量大
	 * 且重新接入后可再采集，不属于配置备份范围（dev-spec §1）。
	 *
	 * 安全：本端点是「用户态响应不碰 token_hash / token_salt」纪律的唯一例外。
	 * 导出哈希与盐是为了恢复后 agent 继续用原 Token 认证、无需重装（dev-spec §6.4）；
	 * 哈希 / 盐等同凭据材料，因此：
	 *   - 响应必须显式 no-store，不允许浏览器 / 代理缓存；
	 *   - 走默认会话认证（GET 天然跳过 CSRF），不加入任何认证 / CSRF / migrate 跳过名单；
	 *   - 日志与错误信息不得出现哈希 / 盐（本控制器不写日志）。
	 * Token 明文从不落库，自然也不会出现在备份里。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		BackupPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);

		$servers = [];
		// 专用只读查询带出哈希 / 盐（常规 getServers 只取公开列，见方法注释）
		foreach ($repository->getServersForBackup() as $row) {
			$servers[] = [
				'name' => (string)$row['name'],
				'note' => (string)($row['note'] ?? ''),
				'group' => (string)($row['group_name'] ?? ''),
				'paused' => 1 === (int)($row['paused'] ?? 0),
				'token_hash' => (string)($row['token_hash'] ?? ''),
				'token_salt' => (string)($row['token_salt'] ?? ''),
			];
		}

		// 下载头：直接访问端点时浏览器存成 super-link-servers-YYYYMMDD.json
		header('Content-Disposition: attachment; filename="' . BackupPayload::fileName('servers') . '"');

		return data(BackupPayload::build('servers', ['servers' => $servers]));
	}
}
