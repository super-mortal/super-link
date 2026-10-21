<?php

namespace Utils;

use Framework\Exceptions\DataWriteException;

class GitHelper
{
	const CLONE_TIMEOUT_SECONDS = 60;
	const FETCH_TIMEOUT_SECONDS = 20;
	const PULL_TIMEOUT_SECONDS = 20;
	const ERROR_OUTPUT_LIMIT = 500;
	const TIMEOUT_EXIT_CODE = 124;
	const KILLED_BY_KILL_EXIT_CODE = 137;

	public function cloneDepth1(string $url, string $dest): void
	{
		$this->run(
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
		$this->run(
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
			throw new DataWriteException(sprintf(
				'[SL-IO-0004] git %s 超时（%d 秒）',
				$operation,
				$timeout_seconds
			));
		}

		if ($exit_code !== 0) {
			throw new DataWriteException(sprintf(
				'[SL-IO-0004] git %s 执行失败（exit code %d）：%s',
				$operation,
				$exit_code,
				$this->summarize($output_text)
			));
		}

		return $output_text;
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
