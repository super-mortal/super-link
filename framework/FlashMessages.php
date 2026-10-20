<?php

namespace Framework;

class FlashMessages
{
	private const string SESSION_KEY = 'flash';

	public static function set(string $type, mixed $value): void
	{
		$_SESSION[self::SESSION_KEY][$type] = $value;
	}

	public static function pull(): array
	{
		$value = $_SESSION[self::SESSION_KEY] ?? [];
		unset($_SESSION[self::SESSION_KEY]);

		return $value;
	}
}