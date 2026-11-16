<?php

namespace Framework\Middlewares;

use Controllers\AgentConnectController;
use Controllers\AgentReportController;
use Controllers\InstallAgentController;
use Framework\Exceptions\DatabaseNotFound;
use Framework\ServiceContainer;
use Models\Repository;

class DatabaseMigrations extends MiddlewareAbstract
{
	protected array $skipped_routes = [
		// agent 态端点（PRD docs/prd/server.md §5.2）：migrate() 幂等但有开销，
		// 长轮询每秒级循环里每个请求都跑一遍没有意义，直接跳过。agent 依赖的
		// servers 等表由用户态任一请求的 migrate 兜底创建（接入 agent 前用户必然
		// 已在界面添加过服务器）。认证中间件「数据库未初始化跳过认证」的判断在
		// 自己的 handle() 里独立完成，不依赖本中间件是否执行过 migrate
		AgentConnectController::class,
		AgentReportController::class,
		InstallAgentController::class,
	];

	public function handle()
	{
		$controller_class = $this->controller_class;
		if (in_array($controller_class, $this->skipped_routes)) {
			return $this->next && $this->next->handle();
		}

		// If the database is not set up yet, skip migration checks
		try {
			$repository = ServiceContainer::get(Repository::class);
		} catch (DatabaseNotFound $e) {
			return $this->next && $this->next->handle();
		}

		if (!$repository->checkDatabaseExists()) {
			return $this->next && $this->next->handle();
		}

		$repository->migrate();

		return $this->next && $this->next->handle();
	}
}