<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;
use function Utils\groupTagsByParent;

class TagsDeleteController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$tag_id = $input['tag-id'] ?? null;

		if (empty($tag_id)) {
			throw new ValidationException('Tag ID is required');
		}

		$repository = ServiceContainer::get(Repository::class);
		$all_tags = $repository->getTags();

		if (!isset($all_tags[$tag_id])) {
			throw new ValidationException("Tag with ID $tag_id does not exist");
		}

		// 标签按模块隔离（PRD O-9）：级联删除只收同一模块内的子标签，
		// 另一模块的同名标签有自己的 id 与父子结构，不能被连带删掉
		$module = $all_tags[$tag_id]['module'] ?? 'bookmarks';
		$module_tags = array_filter($all_tags, fn($tag) => ($tag['module'] ?? 'bookmarks') === $module);

		// Delete all child tags as well
		$tags_by_parent = groupTagsByParent($module_tags);
		$tags_to_delete = [$tag_id, ...$tags_by_parent[$tag_id] ?? []];

		// Delete tags associations with items and skills
		// （SQLite 未开外键级联，两张关联表都要手动清理，见 Repository::deleteSkillsTagsAttachment）
		$repository = ServiceContainer::get(Repository::class);
		$result = $repository->deleteTagsItemAttachment($tags_to_delete);

		if (false === $result) {
			throw new DataWriteException("Error removing tag item associations");
		}

		$result = $repository->deleteSkillsTagsAttachment($tags_to_delete);

		if (false === $result) {
			throw new DataWriteException("Error removing tag skill associations");
		}

		// Delete tags
		$result = $repository->deleteTags($tags_to_delete);

		if (false === $result) {
			throw new DataWriteException("Error deleting tag");
		}

		return success(
			(count($tags_to_delete) > 1 ? count($tags_to_delete) . ' tags' : 'Tag') . ' deleted successfully',
		);
	}

}
