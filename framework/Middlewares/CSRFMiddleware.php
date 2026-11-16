<?php

namespace Framework\Middlewares;

use Controllers\AgentConnectController;
use Controllers\AgentReportController;
use Controllers\InstallAgentController;
use Framework\CSRFProtection;
use Framework\Exceptions\ForbiddenException;

class CSRFMiddleware extends MiddlewareAbstract
{

	protected array $skipped_routes = [
		// agent 态端点（PRD docs/prd/server.md §5.6）：agent 请求不带浏览器
		// 会话 cookie，也没有 CSRF token，写操作（report）必须显式豁免；
		// connect 与 install-agent 虽是 GET 天然跳过，仍显式注册保持名单完整
		AgentConnectController::class,
		AgentReportController::class,
		InstallAgentController::class,
	];

	public function handle()
	{
		$controller_class = $this->controller_class;
		// Skip for specific routes
		if (in_array($controller_class, $this->skipped_routes)) {
			return $this->next && $this->next->handle();
		}

		$stored_token = $_COOKIE['CSRF-TOKEN'] ?? null;
		$token = CSRFProtection::generateToken();
		if ($stored_token !== $token) {
			setcookie('CSRF-TOKEN', $token, [
				'expires' => time() + 60 * 60 * 24, // 24 hours
				'httponly' => false, // Accessible via JavaScript
				'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on',
				'path' => '/',
				'samesite' => 'Lax',
			]);
		}


		// Skip CSRF check for GET requests
		if ($this->method === 'GET') {
			return $this->next && $this->next->handle();
		}

		// Verify CSRF token
		$input_token = $_POST['csrf_token'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';

		if (!CSRFProtection::verifyToken($input_token)) {
			throw new ForbiddenException('CSRF token validation failed');
		}

		return $this->next && $this->next->handle();
	}
}
