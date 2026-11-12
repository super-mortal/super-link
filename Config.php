<?php
declare(strict_types=1);

use Framework\ServiceContainer;
use Models\Repository;
use Throwable;

class Config
{
	protected const string DB_NAME_DEFAULT = 'link_navigator';
	protected const string STORAGE_PATH = ROOT_DIR . '/storage';

	// GitHub 网络访问三档设置（PRD optimization.md O-5）。
	// 环境变量只作为初始默认值，设置页保存后以 app_settings 表为准
	public const string SETTING_KEY_GITHUB_ACCESS_MODE = 'github_access_mode';
	public const string SETTING_KEY_GITHUB_PROXY_PREFIX = 'github_proxy_prefix';
	public const string SETTING_KEY_APP_UPDATE_CHECK = 'app_update_check';

	protected const string GITHUB_ACCESS_MODE_DEFAULT = 'auto';
	protected const string GITHUB_PROXY_PREFIX_DEFAULT = '';
	protected const string APP_UPDATE_CHECK_DEFAULT = '1';

	/** 合法访问策略：auto（优先直连，失败再走代理）/ proxy（始终代理）/ direct（直连） */
	protected const array GITHUB_ACCESS_MODES = ['auto', 'proxy', 'direct'];

	/** 单请求内缓存：一次请求里 clone / fetch / 版本检查可能多次读取设置 */
	private static ?array $settings_cache = null;

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

	/**
	 * GitHub 访问策略（O-5）：auto / proxy / direct
	 *
	 * 数据库设置优先，环境变量 GITHUB_ACCESS_MODE 仅作初始默认值；
	 * 非法值写 error_log 并回退默认档位，避免配置错误让 Skill 安装完全不可用。
	 */
	public static function getGithubAccessMode(): string
	{
		$raw = (self::getSetting(self::SETTING_KEY_GITHUB_ACCESS_MODE) ?? getenv('GITHUB_ACCESS_MODE'))
			?: self::GITHUB_ACCESS_MODE_DEFAULT;

		return self::normalizeGithubAccessMode($raw);
	}

	/**
	 * GitHub 代理前缀（O-5），如 https://gh-proxy.com/
	 *
	 * 空字符串表示未配置代理；非法值同样回落为空（等价 direct）并写 error_log。
	 */
	public static function getGithubProxyPrefix(): string
	{
		$raw = self::getSetting(self::SETTING_KEY_GITHUB_PROXY_PREFIX);
		if ($raw === null) {
			$raw = getenv('GITHUB_PROXY_PREFIX') ?: self::GITHUB_PROXY_PREFIX_DEFAULT;
		}

		return self::normalizeGithubProxyPrefix((string)$raw) ?? '';
	}

	/**
	 * 是否启用应用版本检查（O-5）：关闭后不再请求 api.github.com，关于页只显示本地版本
	 */
	public static function isAppUpdateCheckEnabled(): bool
	{
		$raw = self::getSetting(self::SETTING_KEY_APP_UPDATE_CHECK);
		if ($raw === null) {
			$raw = getenv('APP_UPDATE_CHECK') ?: self::APP_UPDATE_CHECK_DEFAULT;
		}

		return filter_var($raw, FILTER_VALIDATE_BOOLEAN);
	}

	/**
	 * 归一化访问策略：仅接受三档，其余回落默认值并记日志
	 */
	public static function normalizeGithubAccessMode(mixed $raw): string
	{
		$mode = strtolower(trim((string)$raw));
		if (in_array($mode, self::GITHUB_ACCESS_MODES, true)) {
			return $mode;
		}

		if ($raw !== null && $raw !== '') {
			error_log(sprintf(
				'[Config] 非法的 GitHub 访问策略：%s，已回退为 %s',
				$raw,
				self::GITHUB_ACCESS_MODE_DEFAULT
			));
		}

		return self::GITHUB_ACCESS_MODE_DEFAULT;
	}

	/**
	 * 归一化代理前缀（O-5）
	 *
	 * 要求：https:// 开头、能解析出 host、不含用户名 / 密码 / query / fragment，末尾自动补 /。
	 * 返回 null 表示非法（调用方决定是拒绝保存还是回落直连）。
	 */
	public static function normalizeGithubProxyPrefix(string $raw): ?string
	{
		$prefix = trim($raw);
		if ($prefix === '') {
			return '';
		}

		$parts = parse_url($prefix);
		$is_valid = is_array($parts)
			&& strtolower($parts['scheme'] ?? '') === 'https'
			&& !empty($parts['host'])
			&& !isset($parts['user'])
			&& !isset($parts['pass'])
			&& !isset($parts['query'])
			&& !isset($parts['fragment']);

		$normalized = $is_valid ? rtrim($prefix, '/') . '/' : '';
		// 再收一道字符白名单：挡掉空格、引号一类会破坏 git -c 参数或伪装主机的内容
		if ($normalized === '' || preg_match('#^https://[A-Za-z0-9._~%!$&\'()*+,;=:@/-]+$#', $normalized) !== 1) {
			error_log(sprintf('[Config] 非法的 GitHub 代理前缀：%s，已按未配置处理', $raw));
			return null;
		}

		return $normalized;
	}

	/** 保存设置后调用：让同一请求内的后续读取立刻看到新值 */
	public static function clearSettingsCache(): void
	{
		self::$settings_cache = null;
	}

	private static function getSetting(string $key): ?string
	{
		return self::getStoredSettings()[$key] ?? null;
	}

	/**
	 * 读取 app_settings 表的全部键值
	 *
	 * 数据库未初始化（首次部署 / setup 前）或表缺失时返回空数组，
	 * 由调用方回落到环境变量默认值——设置读取永远不应让请求失败。
	 */
	private static function getStoredSettings(): array
	{
		if (self::$settings_cache !== null) {
			return self::$settings_cache;
		}

		self::$settings_cache = [];

		try {
			$repository = ServiceContainer::get(Repository::class);
			self::$settings_cache = $repository->getAppSettings();
		} catch (Throwable $e) {
			self::$settings_cache = [];
		}

		return self::$settings_cache;
	}
}
