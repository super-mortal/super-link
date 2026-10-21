<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Throwable;
use Utils\SkillInstaller;
use function Framework\success;

class SkillsDeleteController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$skill_ids = $this->parseSkillIds($input);

		$repository = ServiceContainer::get(Repository::class);

		// 先确认存在性：不存在的 id 只跳过，保证重复删除请求仍然成功（幂等）。
		$existing = [];

		foreach ($skill_ids as $skill_id) {
			$row = $repository->getSkill($skill_id);

			if ($row) {
				$existing[] = $row;
			}
		}

		$missing_count = count($skill_ids) - count($existing);

		if ($existing === []) {
			return success($this->buildMessage(0, $missing_count, []), ['ids' => []]);
		}

		$deleted_ids = array_map(static fn(array $row): int => (int)$row['id'], $existing);

		$result = $repository->deleteSkillsTags($deleted_ids, []);

		if (false === $result) {
			throw new DataWriteException('[SL-EXT-0001] Skill 标签删除失败');
		}

		foreach ($deleted_ids as $skill_id) {
			$result = $repository->deleteSkill($skill_id);

			if (false === $result) {
				throw new DataWriteException('[SL-EXT-0001] Skill 删除失败');
			}
		}

		// 目录删除失败不回滚 DB：库里已经没有这条记录，残留目录下次安装会被同名检查拦下。
		$installer = new SkillInstaller($repository);
		$failed_names = [];

		foreach ($existing as $row) {
			$name = (string)$row['name'];

			try {
				$installer->removeSkillDirectory($this->resolveDirectory($name));
			} catch (Throwable $e) {
				$failed_names[] = $name;
				error_log(sprintf(
					'[SkillsDelete] Skill 目录删除失败 name=%s: %s',
					$name,
					$e->getMessage()
				));
			}
		}

		return success(
			$this->buildMessage(count($deleted_ids), $missing_count, $failed_names),
			['ids' => $deleted_ids]
		);
	}

	/**
	 * 同时接受 `ids`（批量）与 `id`（单个），两者都为空或非法时返回 422。
	 *
	 * @return int[]
	 */
	private function parseSkillIds(array $input): array
	{
		$raw = $input['ids'] ?? null;

		if ($raw === null || $raw === '' || $raw === []) {
			$raw = $input['id'] ?? null;

			if ($raw === null || $raw === '') {
				throw new ValidationException('[SL-SKL-0007] 缺少或非法的 Skill id 参数');
			}

			$raw = [$raw];
		}

		if (!is_array($raw) || $raw === []) {
			throw new ValidationException('[SL-SKL-0007] 缺少或非法的 Skill id 参数');
		}

		$ids = [];

		foreach ($raw as $value) {
			$id = $this->parseId($value);

			// 去重，避免同一 id 重复走删除流程。
			$ids[$id] = $id;
		}

		return array_values($ids);
	}

	private function parseId(mixed $raw): int
	{
		if (is_int($raw) && $raw > 0) {
			return $raw;
		}

		if (is_string($raw) && ctype_digit($raw) && (int)$raw > 0) {
			return (int)$raw;
		}

		throw new ValidationException('[SL-SKL-0007] 缺少或非法的 Skill id 参数');
	}

	/**
	 * 目录名只取自 DB 记录，不接受请求传入的路径片段。
	 */
	private function resolveDirectory(string $name): string
	{
		if ($name === '' || $name === '.' || $name === '..' || str_contains($name, '/') || str_contains($name, '\\')) {
			throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝操作');
		}

		return rtrim(Config::getSkillsStoragePath(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name;
	}

	/**
	 * @param string[] $failed_names
	 */
	private function buildMessage(int $deleted_count, int $missing_count, array $failed_names): string
	{
		$message = sprintf('已删除 %d 个 Skill', $deleted_count);

		if ($missing_count > 0) {
			$message .= sprintf('，%d 个不存在已跳过', $missing_count);
		}

		if ($failed_names !== []) {
			$message .= sprintf('，%d 个目录删除失败：%s', count($failed_names), implode('、', $failed_names));
		}

		return $message;
	}
}
