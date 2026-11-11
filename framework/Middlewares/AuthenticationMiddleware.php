<?php

namespace Framework\Middlewares;

use Controllers\AppInfoController;
use Controllers\AuthLoginController;
use Framework\Exceptions\DatabaseNotFound;
use Framework\Exceptions\UnauthorizedException;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\getLoggedInUser;

class AuthenticationMiddleware extends MiddlewareAbstract
{
	protected array $skip_auth_routes = [
		// API Auth routes
		AuthLoginController::class,
		// PRD O-6：登录页底部要展示版本号，而登录页只在启用认证时才会打开，
		// 因此 app-info 必须允许未登录读取。该接口只返回本地版本号与
		// GitHub Release 公开信息，不含任何用户数据
		AppInfoController::class,
	];

	public function handle()
	{
		$controller_class = $this->controller_class;
		// Skip authentication for specific routes
		if (in_array($controller_class, $this->skip_auth_routes)) {
			return $this->next && $this->next->handle();
		}

		// If the database is not set up yet, skip authentication checks
		try {
			$repository = ServiceContainer::get(Repository::class);
		} catch (DatabaseNotFound $e) {
			return $this->next && $this->next->handle();
		}

		if (!$repository->checkDatabaseExists()) {
			return $this->next && $this->next->handle();
		}

		$auth_enabled = $repository->userTableNotEmpty();

		// If auth is disabled, skip authentication check
		if (!$auth_enabled) {
			return $this->next && $this->next->handle();
		}

		$user = getLoggedInUser();

		if ($user) {
			return $this->next && $this->next->handle();
		}

		throw new UnauthorizedException();
	}
}