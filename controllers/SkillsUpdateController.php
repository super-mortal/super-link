<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\SkillInstaller;
use function Framework\success;

class SkillsUpdateController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$skill_ids = $this->parseSkillIds($input);

		$repository = ServiceContainer::get(Repository::class);
		$installer = new SkillInstaller($repository);

		// 先整批校验来源再动手：批量更新不能出现「前几个已更新、后面才报 0005」的半成品。
		$rows = [];

		foreach ($skill_ids as $skill_id) {
			$row = $repository->getSkill($skill_id);

			if (!$row) {
				throw new NotFoundException('[SL-SKL-0002] Skill 不存在');
			}

			if ((string)($row['source_type'] ?? '') !== SkillInstaller::SOURCE_TYPE_GITHUB) {
				throw new ValidationException('[SL-SKL-0005] 上传来源没有上游仓库，无法更新，请重新上传');
			}

			$rows[] = $row;
		}

		$skills = [];

		foreach ($rows as $row) {
			$skills[] = $installer->updateFromGithub($row);
		}

		return success(
			sprintf('已更新 %d 个 Skill 到最新版本', count($skills)),
			[
				'skills' => $skills,
				'updated' => count($skills),
			]
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

			// 去重，避免同一 id 被更新两次。
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
}
