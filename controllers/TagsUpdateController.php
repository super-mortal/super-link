<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Respect\Validation\Validator;
use function Framework\success;
use function Utils\processInputTags;

class TagsUpdateController implements ControllerInterface
{
	public function validateInput()
	{
		return Validator::key('tag-id', Validator::stringType()->notEmpty())
			->key('parent', Validator::anyOf(Validator::stringType(), Validator::intType())->setName('Parent Tag ID'))
			->key('title', Validator::stringType()->notEmpty()->length(1, 255))
			->key('description', Validator::stringType()->length(null, 1000));
	}

	public function __invoke(array $input): ResponseInterface
	{
		$tag_id = (int)$input['tag-id'];

		$repository = ServiceContainer::get(Repository::class);
		// 标签按模块隔离（PRD O-9）：父标签只能来自同一模块。先取全量字典确认
		// 标签存在并读出它的 module，再按该模块校验 / 新建父标签，避免把另一
		// 模块的同名标签设成父级（侧栏树会跨模块串层级）
		$all_tags = $repository->getTags();
		$tag = $all_tags[$tag_id] ?? null;

		if (null === $tag) {
			throw new ValidationException("Tag with ID $tag_id does not exist");
		}

		$module = $tag['module'] ?? 'bookmarks';

		if ($input['parent'] === 0) {
			$parent_id = 0;
		} else {
			[$parent_id] = processInputTags([$input['parent']], $module);
		}

		if ($tag_id === $parent_id) {
			throw new \Exception('Tag cannot be the same as parent');
		}

		$tag_title = trim($input['title']);
		$tag_description = trim($input['description']);

		$repository->updateTag(
			$tag_id,
			$tag_title,
			$tag_description,
			$parent_id
		);

		return success(
			'Tag updated successfully',
			[
				'tag_id' => $tag_id,
				'parent_id' => $parent_id,
				'title' => $input['title'],
				'description' => $input['description'],
			]
		);
	}

}