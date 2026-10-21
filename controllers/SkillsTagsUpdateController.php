<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;

class SkillsTagsUpdateController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$skill_ids = $this->parseSkillIds($input);
		$tag_ids = $this->parseTagIds($input['tags'] ?? null);

		$repository = ServiceContainer::get(Repository::class);

		$existing_tag_ids = array_keys($repository->getTags());

		if (array_diff($tag_ids, $existing_tag_ids)) {
			throw new ValidationException('[SL-SKL-0008] 提交的标签不存在，请刷新后重试');
		}

		foreach ($skill_ids as $skill_id) {
			if (!$repository->getSkill($skill_id)) {
				throw new NotFoundException('[SL-SKL-0002] Skill 不存在');
			}
		}

		// 全量替换：先清空这些 Skill 的全部关联，再写入本次提交的标签。
		$result = $repository->deleteSkillsTags($skill_ids, []);

		if (false === $result) {
			throw new DataWriteException('[SL-EXT-0001] Skill 标签删除失败');
		}

		if (false === $repository->attachSkillTags($skill_ids, $tag_ids)) {
			throw new DataWriteException('[SL-EXT-0001] Skill 标签写入失败');
		}

		// 标签变更同样算一次内容变更，列表按 updated_at 排序时要体现出来。
		$repository->refreshSkillsUpdatedAt($skill_ids);

		return success('标签更新成功', [
			'ids' => $skill_ids,
			'tags' => $tag_ids,
		]);
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
			$id = $this->parseSkillId($value);

			$ids[$id] = $id;
		}

		return array_values($ids);
	}

	private function parseSkillId(mixed $raw): int
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
	 * 空数组表示清空全部标签，与全量替换语义一致。
	 *
	 * @return int[]
	 */
	private function parseTagIds(mixed $raw): array
	{
		if (!is_array($raw)) {
			throw new ValidationException('[SL-SKL-0009] tags 参数缺失或不是整数数组');
		}

		$ids = [];

		foreach ($raw as $value) {
			if (is_int($value) && $value > 0) {
				$ids[$value] = $value;
				continue;
			}

			if (is_string($value) && ctype_digit($value) && (int)$value > 0) {
				$id = (int)$value;
				$ids[$id] = $id;
				continue;
			}

			throw new ValidationException('[SL-SKL-0009] tags 参数缺失或不是整数数组');
		}

		return array_values($ids);
	}
}
