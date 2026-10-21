<?php
declare(strict_types=1);

class Config
{
	protected const string DB_NAME_DEFAULT = 'link_navigator';
	protected const string STORAGE_PATH = ROOT_DIR . '/storage';

	public static function getDBPath(): string
	{
		$db_name = getenv('DB_NAME') ?: self::DB_NAME_DEFAULT;
		return sprintf('%s/%s.db', self::STORAGE_PATH, $db_name);
	}

	public static function getSkillsStoragePath(): string
	{
		$path = self::STORAGE_PATH . '/skills';
		if (!is_dir($path)) {
			mkdir($path, 0755, true);
		}
		return $path;
	}

	public static function getWatchtowerUrl(): string
	{
		return rtrim(getenv('WATCHTOWER_URL') ?: 'http://watchtower:8080', '/');
	}

	public static function getWatchtowerToken(): string
	{
		return getenv('WATCHTOWER_TOKEN') ?: '';
	}

	public static function getPasswordAlgo(): string
	{
		if (in_array(PASSWORD_ARGON2ID, password_algos())) {
			return PASSWORD_ARGON2ID;
		}
		return PASSWORD_DEFAULT;
	}

	public static function getSessionLifetime(): int
	{
		return 60 * 60 * 24 * 7; // 7 days
	}

	public static function getSessionCookieName(): string
	{
		return 'link-navigator-session';
	}
}
