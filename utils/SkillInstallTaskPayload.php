<?php

namespace Utils;

/**
 * Skill 安装任务的任务态与出参白名单（refinements-v0.1.2 §4.4 方案 B）
 *
 * 启动端点与状态查询端点共用 format()，避免两处各写一份字段映射；
 * 只输出任务本身的公开字段（来源地址、名称、状态、阶段、错误摘要、已用时长），
 * 任务表里也不存在任何凭据类字段。
 */
class SkillInstallTaskPayload
{
	const STATUS_PENDING = 'pending';
	const STATUS_RUNNING = 'running';
	const STATUS_SUCCESS = 'success';
	const STATUS_FAILED = 'failed';

	/** 超时阈值：超过该分钟数仍未结束的任务由查询端点 / migrate 置为 failed */
	const TIMEOUT_MINUTES = 10;

	/** 错误摘要上限：git / 异常信息可能很长，落库与展示都只保留摘要 */
	const MESSAGE_MAX_LENGTH = 500;

	/**
	 * 任务行 → 出参
	 *
	 * elapsed_seconds 在任务结束（success / failed）后固定为「创建 → 最后更新」的差值，
	 * 进行中则按当前时间实时计算，前端直接展示已用时长，无需自己解析时间串。
	 *
	 * @param array      $row   任务表原始行
	 * @param array|null $skill 任务成功时附带的 Skill 对象（与 GET /api/skills 同形）
	 */
	public static function format(array $row, ?array $skill = null): array
	{
		$created = strtotime((string)($row['created_at'] ?? '')) ?: null;
		$updated = strtotime((string)($row['updated_at'] ?? '')) ?: null;
		$status = (string)($row['status'] ?? self::STATUS_PENDING);
		$finished = in_array($status, [self::STATUS_SUCCESS, self::STATUS_FAILED], true);

		$elapsed = 0;
		if ($created !== null) {
			$elapsed = max(0, ($finished && $updated !== null ? $updated : time()) - $created);
		}

		$task = [
			'id' => (int)($row['id'] ?? 0),
			'skill_name' => (string)($row['skill_name'] ?? ''),
			'source_url' => (string)($row['source_url'] ?? ''),
			'status' => $status,
			'stage' => (string)($row['stage'] ?? ''),
			'message' => (string)($row['message'] ?? ''),
			'created_at' => $row['created_at'] ?? null,
			'updated_at' => $row['updated_at'] ?? null,
			'elapsed_seconds' => $elapsed,
		];

		if ($skill !== null) {
			$task['skill'] = $skill;
		}

		return $task;
	}

	/**
	 * 错误摘要归一：去掉服务器绝对路径与换行，截断到固定长度
	 *
	 * worker 捕获到的异常信息可能包含 ROOT_DIR 绝对路径（如 git 输出），
	 * 与 GitHelper::summarize() 同一口径脱敏，任务表不落服务器目录结构。
	 */
	public static function summarizeError(string $message): string
	{
		$summary = trim(str_replace(["\r\n", "\r"], ' ', $message));

		if (defined('ROOT_DIR')) {
			// ROOT_DIR 由入口写成含 `..` 的形式（如 /var/www/html/utils/..），
			// 而异常里的路径多为规范化后的绝对路径，两种形态都要抹掉
			$root = realpath(ROOT_DIR);
			$summary = str_replace(
				$root === false ? [ROOT_DIR] : [ROOT_DIR, $root],
				'<root>',
				$summary
			);
		}

		if ($summary === '') {
			$summary = '[SL-EXT-0001] Skill 安装失败：未知错误';
		}

		return mb_substr($summary, 0, self::MESSAGE_MAX_LENGTH);
	}
}
