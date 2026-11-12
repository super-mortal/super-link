<?php

namespace Utils;

use Config;
use Framework\Exceptions\DataWriteException;

class GitHelper
{
	const CLONE_TIMEOUT_SECONDS = 60;
	const FETCH_TIMEOUT_SECONDS = 20;
	const PULL_TIMEOUT_SECONDS = 20;
	// O-5：auto 档位下直连尝试用较短超时，失败后再走代理（沿用上面的完整超时），
	// 避免用户等待「60 秒 + 60 秒」
	const DIRECT_TIMEOUT_SECONDS = 10;
	const ERROR_OUTPUT_LIMIT = 500;
	const TIMEOUT_EXIT_CODE = 124;
	const KILLED_BY_KILL_EXIT_CODE = 137;
	// O-5：代理前缀只改写这两类原始地址，git 配置无法借此访问其他主机（SSRF 防护）；
	// 调用方传入的地址均已校验为 https://github.com（SkillInstaller::normalizeGithubUrl）
	const PROXIED_ORIGINS = [
		'https://github.com/',
		'https://codeload.github.com/',
	];

	public function cloneDepth1(string $url, string $dest): void
	{
		$this->runWithNetworkStrategy(
			['git', 'clone', '--depth', '1', '--', $url, $dest],
			self::CLONE_TIMEOUT_SECONDS,
			'clone'
		);
	}

	public function head(string $dest): string
	{
		return trim($this->run(
			['git', '-C', $dest, 'rev-parse', 'HEAD'],
			self::FETCH_TIMEOUT_SECONDS,
			'rev-parse'
		));
	}

	/**
	 * Fetch the remote default branch head and return its full SHA.
	 *
	 * The installed clone is single-branch (`clone --depth 1`), so the default
	 * refspec only ever advances the default branch; FETCH_HEAD therefore is the
	 * upstream head — the same ref resetToFetched() moves the work tree to.
	 */
	public function fetchHead(string $dest): string
	{
		$this->runWithNetworkStrategy(
			['git', '-C', $dest, 'fetch', '--depth', '1', 'origin'],
			self::FETCH_TIMEOUT_SECONDS,
			'fetch'
		);

		return trim($this->run(
			['git', '-C', $dest, 'rev-parse', 'FETCH_HEAD'],
			self::FETCH_TIMEOUT_SECONDS,
			'rev-parse'
		));
	}

	/**
	 * Hard reset to the last fetched head.
	 *
	 * `pull --ff-only` aborts when the local branch diverged (or when untracked
	 * files collide); reset is deterministic and repeatable for an installed
	 * skill, whose local edits are not meant to survive an update.
	 */
	public function resetToFetched(string $dest): void
	{
		$this->run(
			['git', '-C', $dest, 'reset', '--hard', 'FETCH_HEAD'],
			self::PULL_TIMEOUT_SECONDS,
			'reset'
		);
	}

	/**
	 * 按「设置 → 网络」的三档策略执行会访问 GitHub 的 git 命令（O-5）
	 *
	 * - direct：只直连；
	 * - proxy：始终带代理前缀，未配置代理地址时直接报错、不发请求；
	 * - auto：先以短超时直连，失败后带代理前缀重试；未配置代理时退化为纯直连。
	 *
	 * 数据库 source_url 与 .git/config 里始终是原始 GitHub 地址，代理只作为传输层
	 * 前缀（git -c url.<prefix>.insteadOf），换代理或去掉代理都继续可用。
	 *
	 * @param array $args 完整 git 命令（首元素为 git）
	 */
	private function runWithNetworkStrategy(array $args, int $timeout_seconds, string $operation): void
	{
		$mode = Config::getGithubAccessMode();
		$prefix = Config::getGithubProxyPrefix();

		if ($mode === 'proxy' && $prefix === '') {
			throw new DataWriteException('[SL-IO-0004] 当前为「始终使用代理」但未配置代理地址，请在「设置 → 网络」填写后重试');
		}

		if ($mode === 'direct' || $prefix === '') {
			$this->run($args, $timeout_seconds, $operation);
			return;
		}

		if ($mode === 'proxy') {
			$this->run($this->withProxyPrefix($args, $prefix), $timeout_seconds, $operation);
			return;
		}

		// auto：直连失败（超时 / 连接错误）才走代理。仓库不存在一类的确定性错误也会重试一次，
		// 代理侧会给出同样的失败原因；两次都失败时以代理侧错误为准并注明已尝试的路径
		try {
			$this->run($args, self::DIRECT_TIMEOUT_SECONDS, $operation);
		} catch (DataWriteException $direct_error) {
			try {
				$this->run($this->withProxyPrefix($args, $prefix), $timeout_seconds, $operation);
			} catch (DataWriteException $proxy_error) {
				throw new DataWriteException(
					$proxy_error->getMessage() . '（自动模式已依次尝试直连与代理）',
					500,
					$proxy_error
				);
			}
		}
	}

	/**
	 * 给 git 命令追加代理前缀改写规则
	 *
	 * 每条 insteadOf 对应一个受支持的原始地址（PROXIED_ORIGINS），同前缀的多条规则
	 * git 会全部应用；$args[0] 约定为 git，其余参数原样跟随。
	 */
	private function withProxyPrefix(array $args, string $prefix): array
	{
		$prefixed = ['git'];
		foreach (self::PROXIED_ORIGINS as $origin) {
			$prefixed[] = '-c';
			$prefixed[] = "url.{$prefix}.insteadOf={$origin}";
		}

		return [...$prefixed, ...array_slice($args, 1)];
	}

	/**
	 * Execute a git command with a hard timeout.
	 *
	 * Every argument is escaped individually, so callers may pass raw user input
	 * (repository URL) without opening a shell injection hole.
	 *
	 * @return string Combined stdout/stderr of the command.
	 */
	private function run(array $args, int $timeout_seconds, string $operation): string
	{
		// GIT_TERMINAL_PROMPT=0 keeps a missing credential from blocking on stdin
		// until the timeout fires; `timeout` is the only watchdog available here.
		$command = sprintf(
			'GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/true timeout -k 5 %d %s 2>&1',
			$timeout_seconds,
			implode(' ', array_map('escapeshellarg', $args))
		);

		$output = [];
		$exit_code = 0;
		exec($command, $output, $exit_code);

		$output_text = trim(implode("\n", $output));

		if ($exit_code === self::TIMEOUT_EXIT_CODE || $exit_code === self::KILLED_BY_KILL_EXIT_CODE) {
			// O-5 错误信息改造：超时不再只报「超时」，补充可操作建议
			throw new DataWriteException(sprintf(
				'[SL-IO-0004] git %s 超时（%d 秒）；连接超时，可在「设置 → 网络」配置代理，或改用上传压缩包安装',
				$operation,
				$timeout_seconds
			));
		}

		if ($exit_code !== 0) {
			throw new DataWriteException(sprintf(
				'[SL-IO-0004] git %s 执行失败（exit code %d）：%s%s',
				$operation,
				$exit_code,
				$this->summarize($output_text),
				$this->suggestAction($output_text)
			));
		}

		return $output_text;
	}

	/**
	 * 按 git 输出补充可操作建议（O-5 错误信息改造）
	 *
	 * 保留 SL-IO-0004 错误码不变，只把笼统失败细化成「原因 + 处理建议」，
	 * 让用户知道可以配置代理或改用上传压缩包，而不是只看到 exit code。
	 */
	private function suggestAction(string $output): string
	{
		$needle = strtolower($output);

		if (str_contains($needle, 'could not resolve host')
			|| str_contains($needle, 'temporary failure in name resolution')
			|| str_contains($needle, 'name or service not known')) {
			return '；DNS 解析失败，请检查服务器网络与 DNS，或在「设置 → 网络」配置代理';
		}
		if (str_contains($needle, 'ssl certificate problem') || str_contains($needle, 'certificate verify failed')) {
			return '；TLS 证书校验失败，请检查服务器系统时间与 CA 证书';
		}
		if (str_contains($needle, 'connection timed out')
			|| str_contains($needle, 'connection refused')
			|| str_contains($needle, 'failed to connect')
			|| str_contains($needle, 'network is unreachable')) {
			return '；无法连接到 GitHub，可在「设置 → 网络」配置代理，或改用上传压缩包安装';
		}
		if (str_contains($needle, 'repository not found')
			|| str_contains($needle, 'authentication failed')
			|| str_contains($needle, 'could not read username')) {
			return '；仓库不存在或没有公开访问权限（不支持私有仓库）';
		}

		return '；请检查服务器网络，或在「设置 → 网络」配置代理后重试';
	}

	private function summarize(string $output): string
	{
		if ($output === '') {
			return '无输出';
		}

		// Never leak the server absolute path to the client.
		$output = str_replace(ROOT_DIR, '<root>', $output);
		$output = str_replace(["\r\n", "\r"], ' ', $output);

		return mb_substr($output, 0, self::ERROR_OUTPUT_LIMIT);
	}
}
