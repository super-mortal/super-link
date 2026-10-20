<?php

namespace Framework;

class CSRFProtection
{
	public static function generateToken() : string
	{
		if (empty($_SESSION['csrf_token'])) {
			$_SESSION['csrf_token'] = bin2hex(random_bytes(32));
		}
		return $_SESSION['csrf_token'];
	}

	public static function verifyToken(string $token): bool
	{
		if (empty($_SESSION['csrf_token']) || empty($token)) {
			return false;
		}
		return hash_equals($_SESSION['csrf_token'], $token);
	}
}