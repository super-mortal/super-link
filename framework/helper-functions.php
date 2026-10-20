<?php

namespace Framework;


use Config;
use Framework\Exceptions\ValidationException;
use Framework\Responses\DataResponse;
use Framework\Responses\PageResponse;
use Framework\Responses\RedirectResponse;
use Models\Repository;

function page(string $page_name, array $data, int $code = 200)
{
	return new PageResponse($page_name, $data, $code);
}

function redirect(string $location, int $code = 303)
{
	return new RedirectResponse($location, $code);
}

function data(array $data, int $code = 200)
{
	return new DataResponse($data, $code);
}

function success(string $message, array $data = [], int $code = 200)
{
	return data([
		'success' => true,
		'message' => $message,
		'data' => $data,
	], $code);
}

function flattenRoutesArray(array $array, string $prefix = ''): array
{
	$result = [];

	foreach ($array as $key => $value) {
		$key = trim($key, '/');
		$prefix = rtrim($prefix, '/');
		$new_key = "{$prefix}/{$key}";

		if (is_array($value)) {
			$result += flattenRoutesArray($value, $new_key); // Recursive call
		} else {
			$result[$new_key] = $value;
		}
	}

	return $result;
}

function validatePassword(string $password)
{
	$password = trim($password);

	if (empty($password)) {
		throw new ValidationException('Password cannot be empty');
	}

	if (!is_string($password) || strlen($password) < 6) {
		throw new ValidationException('Password must be at least 6 characters long');
	}
}

function validatePasswordConfirmation(string $password, string $confirm_password)
{
	$password = trim($password);
	$confirm_password = trim($confirm_password);

	if (empty($confirm_password)) {
		throw new ValidationException('Password confirmation cannot be empty');
	}

	if ($password !== $confirm_password) {
		throw new ValidationException('Password confirmation does not match the password');
	}
}

function validateUsername(string $username)
{
	$username = trim($username);

	if (empty($username)) {
		throw new ValidationException('用户名不能为空');
	}

	if (!is_string($username) || !preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
		throw new ValidationException('用户名格式无效，请使用字母、数字和下划线');
	}
}

function startSession(): void
{
	// 7 days
	$session_lifetime = Config::getSessionLifetime();

	session_start([
		'name' => Config::getSessionCookieName(),
		'cookie_lifetime' => $session_lifetime,
		'gc_maxlifetime' => $session_lifetime,
		'cookie_path' => '/',
		'cookie_secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on',
		'cookie_httponly' => true,
		'cookie_samesite' => 'Lax',
	]);
}

function loginUser(int $user_id): void
{
	if (!isset($_SESSION)) {
		startSession();
	}

	$_SESSION['user_id'] = $user_id;
}

function logoutUser(): void
{
	if (!isset($_SESSION)) {
		return;
	}

	$_SESSION['user_id'] = null;
}

function getLoggedInUser()
{
	if (!isset($_SESSION['user_id'])) {
		return null;
	}

	$repository = ServiceContainer::get(Repository::class);
	return $repository->getUser($_SESSION['user_id']);
}

function isValidHttpCode($http_code)
{
	return is_int($http_code) && $http_code >= 100 && $http_code <= 599;
}
