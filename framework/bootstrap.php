<?php

use Framework\Application;
use Framework\Middlewares\AuthenticationMiddleware;
use Framework\Middlewares\CSRFMiddleware;
use Framework\Middlewares\DatabaseMigrations;
use function Framework\startSession;

startSession();

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
$path = $_SERVER['SCRIPT_URL'];
$method = $_POST['force-method'] ?? $_SERVER["REQUEST_METHOD"];
$app = new Application($routes, $middleware_classes, $error_redirects);
$app->run($path, $method);
