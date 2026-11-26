<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\SkillInstallTaskPayload;
use function Framework\success;

class SkillsInstallStatusController implements ControllerInterface
{
	/**
	 * GET /api/skills/install/status?task-id= （同时接受 GET /api/skills/install-status?id=）
	 *
	 * 返回安装任务的当前 status / stage / message / elapsed_seconds；任务成功时
	 * 附带与 GET /api/skills 同形的 skill 对象（含 tags），前端拿到即可刷新列表。
	 * 两种路径与参数并存是为了兼容 dev-spec §4.1（task-id）与本次任务书（id），
	 * 控制器内部统一归一，路由在 routes.php 各注册一条。
	 *
	 * 用户态端点：不走认证跳过名单，未登录由 Authentication 中间件统一 401。
	 * 响应只有任务公开字段，不含任何 Token / 凭据。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$id = $this->parseId($input['task-id'] ?? $input['task_id'] ?? $input['id'] ?? null);

		$repository = ServiceContainer::get(Repository::class);

		// 查询前先做一次超时兜底：worker 被系统杀掉时任务不会永远停在 running
		$repository->failStaleSkillInstallTasks(SkillInstallTaskPayload::TIMEOUT_MINUTES);

		$task = $repository->getSkillInstallTask($id);

		if ($task === null) {
			throw new NotFoundException('[SL-SKL-0002] 安装任务不存在或已被清理');
		}

		$skill = null;

		if ((string)$task['status'] === SkillInstallTaskPayload::STATUS_SUCCESS) {
			$skill = $this->findSkill($repository, (string)$task['skill_name']);
		}

		return success('获取安装任务状态成功', [
			'task' => SkillInstallTaskPayload::format($task, $skill),
		]);
	}

	/**
	 * id 必须是正整数（强校验）：格式非法直接 400，不进入查询
	 */
	private function parseId(mixed $raw): int
	{
		if (is_int($raw) && $raw > 0) {
			return $raw;
		}

		if (is_string($raw) && ctype_digit($raw) && (int)$raw > 0) {
			return (int)$raw;
		}

		throw new ValidationException('[SL-SKL-0007] 缺少或非法的安装任务 id 参数', 400);
	}

	/**
	 * 成功任务对应的 Skill 行（与 SkillsGetController::formatSkill 同形）
	 *
	 * 任务成功后 worker 必然已写入 skills 行；若行随后被用户删除则返回 null，
	 * 前端按「任务成功但 Skill 已不存在」处理即可，不把这种情况当成接口错误。
	 */
	private function findSkill(Repository $repository, string $name): ?array
	{
		$row = $repository->getSkillByName($name);

		if (!$row) {
			return null;
		}

		return [
			'id' => (int)$row['id'],
			'name' => $row['name'],
			'description' => $row['description'],
			'source_type' => $row['source_type'],
			'source_url' => $row['source_url'],
			'fingerprint' => $row['fingerprint'],
			'installed_at' => $row['installed_at'],
			'updated_at' => $row['updated_at'],
			'tags' => array_values($repository->getSkillTags()[(int)$row['id']] ?? []),
		];
	}
}
