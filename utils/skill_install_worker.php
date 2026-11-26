<?php
declare(strict_types=1);

/**
 * Skill 安装任务 worker（refinements-v0.1.2 §4.4 方案 B）
 *
 * 由 SkillsInstallController 通过 exec 异步拉起：`php utils/skill_install_worker.php <taskId>`。
 * 只接受一个数字任务 id 参数（调用方用 escapeshellarg 拼接，用户输入永不进入命令行），
 * 依次执行「连接仓库 → 克隆 → 校验 SKILL.md → 写入 storage/skills」，每步把真实阶段写回
 * skill_install_tasks；失败时 status=failed + 错误摘要（沿用 SL-* 错误码），不向页面抛异常。
 *
 * 不加载 framework/bootstrap.php：worker 没有会话 / 路由 / 中间件，只复用 init.php 的
 * 容器绑定与 Autoload；数据库缺失或表不存在时直接退出，任务由查询端点的超时兜底收尾。
 */

use Framework\ServiceContainer;
use Models\Repository;
use Throwable;
use Utils\SkillInstaller;
use Utils\SkillInstallTaskPayload;

const ROOT_DIR = __DIR__ . '/..';

// 与 web 请求保持一致：任务表时间戳（created_at / updated_at）两边必须同一时区
date_default_timezone_set('Asia/Shanghai');

require ROOT_DIR . '/vendor/autoload.php';
require_once ROOT_DIR . '/init.php';

$task_id = 0;

if (isset($argv[1]) && is_string($argv[1]) && ctype_digit($argv[1]) && (int)$argv[1] > 0) {
	$task_id = (int)$argv[1];
}

if ($task_id <= 0) {
	exit(1);
}

try {
	$repository = ServiceContainer::get(Repository::class);
} catch (Throwable $e) {
	// 数据库不可用时没有地方可写；查询端点会在超时后把任务置 failed
	exit(1);
}

// 原子认领：只有把 pending 改成 running 的这次执行继续，重复拉起不会双跑
if (!$repository->claimSkillInstallTask($task_id)) {
	exit(0);
}

$task = $repository->getSkillInstallTask($task_id);

if ($task === null) {
	exit(0);
}

$installer = new SkillInstaller($repository);

// 阶段回调：SkillInstaller 在每个阶段开始时调用，同步刷新 updated_at（超时判定依据）；
// 只更新 stage，不重复写 status（已被超时兜底置 failed 的任务不会被「复活」）
$on_stage = function (string $stage) use ($repository, $task_id): void {
	$repository->updateSkillInstallTaskStage($task_id, $stage);
};

try {
	$installer->installFromGithub((string)$task['source_url'], $on_stage);
	// stage 已由最后一次阶段回调停在 write；终态只写一次，超时失败的任务不覆盖
	$repository->finishSkillInstallTask(
		$task_id,
		SkillInstallTaskPayload::STATUS_SUCCESS,
		''
	);
} catch (Throwable $e) {
	// 安装失败已经把半成品目录清掉（SkillInstaller 内部保证），这里只回写摘要；
	// 错误信息经统一脱敏 / 截断，不落服务器绝对路径
	$repository->finishSkillInstallTask(
		$task_id,
		SkillInstallTaskPayload::STATUS_FAILED,
		SkillInstallTaskPayload::summarizeError($e->getMessage())
	);
}

exit(0);
