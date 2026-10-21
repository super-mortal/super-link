<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;

class SkillsGetController implements ControllerInterface
{
	/**
	 * 与前端 MODULES.skills.sorts 的 key 一一对应；未知值回落 installed-desc。
	 */
	private const SORTS = [
		'installed-desc' => ['installed_at', 'desc'],
		'installed-asc' => ['installed_at', 'asc'],
		'name-asc' => ['name', 'asc'],
		'name-desc' => ['name', 'desc'],
		'updated-desc' => ['updated_at', 'desc'],
	];

	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$skills = array_map([$this, 'formatSkill'], array_values($repository->getSkills()));
		$skills = $this->applyFilters($skills, $input);

		[$field, $direction] = self::SORTS[(string)($input['sort'] ?? '')] ?? self::SORTS['installed-desc'];

		usort($skills, function (array $left, array $right) use ($field, $direction): int {
			$result = $field === 'name'
				? strcasecmp($left['name'], $right['name'])
				: strcmp($left[$field], $right[$field]);

			return $direction === 'asc' ? $result : -$result;
		});

		return success('获取 Skill 列表成功', [
			'skills' => $skills,
		]);
	}

	private function formatSkill(array $row): array
	{
		return [
			'id' => (int)$row['id'],
			'name' => $row['name'],
			'description' => $row['description'],
			'source_type' => $row['source_type'],
			'source_url' => $row['source_url'],
			'fingerprint' => $row['fingerprint'],
			'installed_at' => $row['installed_at'],
			'updated_at' => $row['updated_at'],
			'tags' => array_values(array_map('intval', $row['tags'] ?? [])),
		];
	}

	/**
	 * 不传参数时返回全量，筛选交给前端；传了就在服务端过滤。
	 */
	private function applyFilters(array $skills, array $input): array
	{
		$search = trim((string)($input['search'] ?? ''));
		$tag = (string)($input['tag'] ?? '');
		$tag_id = ctype_digit($tag) ? (int)$tag : 0;

		$filtered = array_filter($skills, function (array $skill) use ($search, $tag_id): bool {
			if ($search !== '' && mb_stripos($skill['name'] . ' ' . $skill['description'], $search) === false) {
				return false;
			}

			return $tag_id === 0 || in_array($tag_id, $skill['tags'], true);
		});

		return array_values($filtered);
	}
}
