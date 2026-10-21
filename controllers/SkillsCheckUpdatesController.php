<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Throwable;
use Utils\SkillInstaller;
use function Framework\success;

class SkillsCheckUpdatesController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$skill_ids = $this->parseSkillIds($input);

		$repository = ServiceContainer::get(Repository::class);
		$installer = new SkillInstaller($repository);

		$rows = array_values($repository->getSkills());

		if ($skill_ids !== []) {
			$this->assertSkillsExist($repository, $skill_ids);
			$wanted = array_flip($skill_ids);
			// 未指定 ids 时全量检查，指定时只检查选中的行。
			$rows = array_values(array_filter(
				$rows,
				static fn(array $row): bool => isset($wanted[(int)$row['id']])
			));
		}

		$updates = [];
		$failed = [];
		$checked = 0;

		foreach ($rows as $row) {
			$skill_id = (int)$row['id'];
			$name = (string)$row['name'];

			// 上传来源没有上游仓库：全量检查时静默跳过，显式指定时如实回报单项失败。
			if ((string)($row['source_type'] ?? '') !== SkillInstaller::SOURCE_TYPE_GITHUB) {
				if ($skill_ids !== []) {
					$failed[] = [
						'id' => $skill_id,
						'name' => $name,
						'error_code' => 'SL-SKL-0005',
					];
				}
				continue;
			}

			$checked++;

			try {
				$latest = $installer->remoteFingerprint($name);
				$current = (string)($row['fingerprint'] ?? '');

				if ($latest !== '' && $latest !== $current) {
					$updates[] = [
						'id' => $skill_id,
						'name' => $name,
						'current' => $current,
						'latest' => $latest,
					];
				}
			} catch (Throwable $e) {
				// 单个仓库超时 / 目录缺失不能中断整批检查。
				$failed[] = [
					'id' => $skill_id,
					'name' => $name,
					'error_code' => $this->extractErrorCode($e),
				];
				error_log(sprintf('[SkillsCheckUpdates] 检查失败 id=%d: %s', $skill_id, $e->getMessage()));
			}
		}

		return success($this->buildMessage($checked, count($updates), count($failed)), [
			'updates' => $updates,
			'checked' => $checked,
			'failed' => $failed,
		]);
	}

	/**
	 * `ids` 可选：不传（或空数组）= 全部 github 来源 Skill。
	 *
	 * @return int[]
	 */
	private function parseSkillIds(array $input): array
	{
		$raw = $input['ids'] ?? null;

		if ($raw === null || $raw === '' || $raw === []) {
			return [];
		}

		if (!is_array($raw)) {
			throw new ValidationException('[SL-SKL-0007] 缺少或非法的 Skill id 参数');
		}

		$ids = [];

		foreach ($raw as $value) {
			$id = $this->parseId($value);

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
	 * @param int[] $skill_ids
	 */
	private function assertSkillsExist(Repository $repository, array $skill_ids): void
	{
		foreach ($skill_ids as $skill_id) {
			if (!$repository->getSkill($skill_id)) {
				throw new NotFoundException('[SL-SKL-0002] Skill 不存在');
			}
		}
	}

	private function extractErrorCode(Throwable $e): string
	{
		if (preg_match('/\[(SL-[A-Z]+-\d{4})\]/', $e->getMessage(), $matches) === 1) {
			return $matches[1];
		}

		return 'SL-EXT-0001';
	}

	private function buildMessage(int $checked, int $update_count, int $failed_count): string
	{
		$message = sprintf('已检查 %d 个 Skill', $checked);
		$message .= $update_count > 0 ? sprintf('，%d 个有更新', $update_count) : '，均为最新版本';

		if ($failed_count > 0) {
			$message .= sprintf('，%d 个检查失败', $failed_count);
		}

		return $message;
	}
}
