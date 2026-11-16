<?php

use Controllers\AgentConnectController;
use Controllers\AgentReportController;
use Controllers\InstallAgentController;
use Exception;
use Framework\Application;
use Framework\Middlewares\AuthenticationMiddleware;
use Framework\Middlewares\CSRFMiddleware;
use Framework\Middlewares\DatabaseMigrations;
use Framework\Router;
use function Framework\startSession;

date_default_timezone_set('Asia/Shanghai');

$middleware_classes = [
	CSRFMiddleware::class,
	DatabaseMigrations::class,
	AuthenticationMiddleware::class,
];

$error_redirects = [
];

// Load project-specific files and services
require_once ROOT_DIR . '/init.php';

// Load routes
$routes = require ROOT_DIR . '/routes.php';

// Run the application
$path = rtrim($_SERVER['SCRIPT_URL'], '/');
$method = $_POST['force-method'] ?? $_SERVER['REQUEST_METHOD'];

// agent 态端点（PRD docs/prd/server.md §5.2 / §5.6）：长轮询接入与快照回传，
// 由被监控机凭 X-Agent-Token 调用，自身没有会话。若照常 startSession()，
// 并发的长轮询请求会锁定同一 session 文件，把用户态请求一起堵住，因此这里
// 按匹配到的控制器类名决定是否跳过；路由未注册（或方法不匹配）时保持原行为
// 照常启动 session，NotFound 仍由 Application::run 统一抛出
$agent_controllers = [
	AgentConnectController::class,
	AgentReportController::class,
	InstallAgentController::class,
];

$is_agent_request = false;
try {
	$router = new Router($routes);
	$is_agent_request = in_array($router->match_controller($path, $method), $agent_controllers, true);
} catch (Exception $e) {
	// 匹配失败：沿用原行为（启动 session），错误响应交给 Application::run
}

if (!$is_agent_request) {
	startSession();
}

$app = new Application($routes, $middleware_classes, $error_redirects);
$app->run($path, $method);
