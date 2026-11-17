<?php

namespace Framework;


use Exception;
use Framework\Exceptions\ValidationException;
use Framework\Middlewares\MiddlewareAbstract;

class Application
{
	public function __construct(protected array $routes, protected array $middleware_classes, protected array $error_redirects)
	{
	}

	public function run($path, $method)
	{
		$path = rtrim($path, '/');
		$expects_json = str_contains(($_SERVER['HTTP_ACCEPT'] ?? '') . ($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json');

		try {
			$router = new Router($this->routes);
			$controller_class = $router->match_controller($path, $method);
			if (!is_subclass_of($controller_class, ControllerInterface::class)) {
				throw new Exception("$controller_class must implement ControllerInterface");
			}

			foreach (array_reverse($this->middleware_classes) as $middleware_class) {
				if (!is_subclass_of($middleware_class, MiddlewareAbstract::class)) {
					throw new Exception("$middleware_class must extend MiddlewareAbstract");
				}
				$middleware = new $middleware_class($middleware ?? null, $path, $method, $controller_class);
			}
			isset($middleware) && $middleware->handle();

			$input = $this->getInput();

			$controller = new $controller_class();
			if (method_exists($controller, 'validateInput')) {
				$validator = $controller->validateInput();
				$validator->check($input);
			}
			$response = $controller($input);

		} catch (Exception $e) {
			$http_code = isValidHttpCode($e->getCode()) ? $e->getCode() : 500;
			$message = $e->getMessage();

			if ($expects_json) {
				$response = data([
					'success' => false,
					'message' => $message,
					'error' => $message,
				], $http_code);
			} elseif (isset($this->error_redirects[get_class($e)])) {
				FlashMessages::set('error', $message);
				$redirect_url = $this->error_redirects[get_class($e)];
				$response = redirect($redirect_url);
			} else {
				$response = page('error', ['message' => $message], $http_code)
					->layout('primary');
			}
		}

		$response->yield();
	}

	public function getInput(): array
	{
		$input_json = str_contains(($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json');

		if (!$input_json) {
			return array_merge($_POST, $_GET, $_FILES);
		}

		$raw_data = file_get_contents("php://input");

		if ('' === $raw_data) {
			return $_GET;
		}
		$input = json_decode($raw_data, true);

		if (json_last_error() !== JSON_ERROR_NONE) {
			throw new ValidationException('Invalid JSON input', 400);
		}

		// 合法 JSON 但顶层不是对象（数字 / 字符串 / 布尔 / null）时，json_decode
		// 返回标量或 null，下面的 array_merge 会抛 TypeError——TypeError 继承
		// Error 而非 Exception，run() 的 catch (Exception) 捕获不到，最终以
		// 500 HTML 暴露给调用方（含 agent 的 JSON 端点）。按同一条 Invalid JSON
		// 的既有范式统一转为 400，信封随 Accept / Content-Type 走 JSON。
		// 空对象 {} 解码为空数组，仍走原路径，行为不变（删除 / 重置 Token 等
		// 空体写依赖该路径）
		if (!is_array($input)) {
			throw new ValidationException('JSON input must be an object', 400);
		}

		return array_merge($input, $_GET);
	}
}

