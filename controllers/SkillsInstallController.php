<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Respect\Validation\Validator;
use Throwable;
use Utils\SkillInstaller;
use Utils\SkillInstallTaskPayload;
use function Framework\success;

class SkillsInstallController implements ControllerInterface
{
	public function validateInput(): Validator
	{
		return Validator::key('url', Validator::stringType()->notEmpty()->setName('URL'));
	}

	/**
	 * POST /api/skills/install
	 *
	 * 入参不变（body `{ url }`），但执行方式改为「建任务 + 异步拉起 worker +
	 * 立即返回」（refinements-v0.1.2 §4.4 方案 B，用户已确认）：
	 *
	 * - 响应从旧的 `{ skill }` 改为 `{ task: { id, status, stage, ... } }`，
	 *   并附带 `task_id` 方便只关心 id 的调用方；前端 InstallSkillDialog /
	 *   mainStore.installSkill 必须改为轮询状态端点（task15）。
	 * - worker 被 exec 拉起失败（exec 被禁用 / PHP 可执行文件缺失）时，任务
	 *   同步置 failed 并写入错误摘要后照常返回任务对象，而非 500：前端仍能
	 *   通过状态端点读到失败原因，不会卡在 pending。
	 * - 同一来源地址或同名 Skill 已有 pending / running 任务时返回 400，
	 *   避免两个 worker 同时操作同一目标目录。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);
		$installer = new SkillInstaller($repository);

		// 保留原站内地址校验与同名预检：非法地址在创建任务前就 400，
		// 不浪费一次 worker 启动；worker 内部会再走一遍同样的校验。
		$url = trim((string)$input['url']);
		[, $name] = $installer->normalizeGithubUrl($url);

		if ($repository->getSkillByName($name)) {
			throw new ValidationException('[SL-SKL-0001] 同名 Skill 已存在，请先删除后再安装', 400);
		}

		// 先收掉已超时的历史进行中任务，再做并发守卫，避免僵尸任务挡住重试
		$repository->failStaleSkillInstallTasks(SkillInstallTaskPayload::TIMEOUT_MINUTES);

		$active = $repository->findActiveSkillInstallTask($url, $name);
		if ($active) {
			throw new ValidationException(sprintf(
				'[SL-SKL-0001] 同一来源的安装任务正在进行中（任务 #%d），请等待完成后再试',
				(int)$active['id']
			), 400);
		}

		$task_id = $repository->createSkillInstallTask($url, $name);

		if ($task_id <= 0) {
			throw new DataWriteException('[SL-EXT-0001] 安装任务创建失败，请稍后重试');
		}

		$launch_error = $this->launchWorker($task_id);

		if ($launch_error !== null) {
			$repository->updateSkillInstallTask($task_id, [
				'status' => SkillInstallTaskPayload::STATUS_FAILED,
				'message' => $launch_error,
			]);
		}

		$task = $repository->getSkillInstallTask($task_id);

		if ($task === null) {
			throw new DataWriteException('[SL-EXT-0001] 安装任务创建后读取失败');
		}

		return success(
			$launch_error === null ? 'Skill 安装任务已创建' : 'Skill 安装任务启动失败',
			[
				'task' => SkillInstallTaskPayload::format($task),
				// 兼容只取任务 id 的调用方（dev-spec §4.1 的 `{ task_id, ... }` 口径）
				'task_id' => (int)$task['id'],
			]
		);
	}

	/**
	 * 异步拉起 CLI worker
	 *
	 * 命令行里只有数字任务 id 与两个固定的脚本路径，用户输入（URL）从不进入
	 * shell；所有片段仍逐个 escapeshellarg。成功返回 null，失败返回写入任务的
	 * 中文错误摘要（沿用 Skill 域 SL-EXT-0001）。
	 *
	 * 生产镜像里 PHP 以 Apache 模块运行（PHP_BINARY 可能为空），因此回落到
	 * PHP_BINDIR/php（php:8.4-apache 的 CLI 二进制在同一目录）。worker 放在
	 * utils/ 下，Dockerfile.build 已 COPY utils，无需改镜像清单。
	 */
	private function launchWorker(int $task_id): ?string
	{
		$disabled = array_filter(array_map('trim', explode(',', (string)ini_get('disable_functions'))));

		if (!function_exists('exec') || in_array('exec', $disabled, true)) {
			return '[SL-EXT-0001] 服务器禁用了 exec，无法启动安装进程；请检查 PHP 配置或改用上传压缩包安装';
		}

		// Apache 模块 SAPI 下 PHP_BINARY 可能为空或指向 web 服务器进程，不能直接
		// 当 CLI 用；只有 CLI / phpdbg 才信任 PHP_BINARY，其它情况取 PHP_BINDIR/php
		//（php:8.4-apache 的 CLI 二进制与 Apache 模块在同一镜像中）
		$php = in_array(PHP_SAPI, ['cli', 'phpdbg'], true) ? PHP_BINARY : '';

		if ($php === '' || !is_file($php)) {
			$php = PHP_BINDIR . DIRECTORY_SEPARATOR . 'php';
		}

		$worker = ROOT_DIR . '/utils/skill_install_worker.php';

		if (!is_file($worker)) {
			return '[SL-EXT-0001] 安装 worker 脚本缺失，请检查部署文件是否完整';
		}

		// 末尾的 & 让 PHP 不等待 worker 结束；输出重定向避免 worker 的 stdout
		// 混进当前请求的响应体。CLI 可能继承 php.ini 的 max_execution_time=60，
		// 而 auto 档位下 git 直连 + 代理重试最坏可超过 60 秒，显式解除限制。
		$command = sprintf(
			'%s -d max_execution_time=0 %s %d > /dev/null 2>&1 &',
			escapeshellarg($php),
			escapeshellarg($worker),
			$task_id
		);

		$output = [];
		$exit_code = 0;

		try {
			exec($command, $output, $exit_code);
		} catch (Throwable $e) {
			return SkillInstallTaskPayload::summarizeError(
				'[SL-EXT-0001] 安装进程启动失败：' . $e->getMessage()
			);
		}

		if ($exit_code !== 0) {
			return sprintf('[SL-EXT-0001] 安装进程启动失败（exit code %d）', $exit_code);
		}

		return null;
	}
}
