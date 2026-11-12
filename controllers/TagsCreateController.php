<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use function Framework\data;
use function Utils\createTagsFromSegments;
use function Utils\extractTagSegments;
use function Utils\normalizeTagModule;

class TagsCreateController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		if (!isset($input['title'])) {
			throw new ValidationException('Invalid input data for tag create.');
		}

		// 标签按模块隔离（PRD O-9）：新建时带 module（bookmarks / skills），
		// 缺省或非法值回退 bookmarks，与 GET /api/tags 的兜底方向一致
		$module = normalizeTagModule($input['module'] ?? null);

		$tag_segments = extractTagSegments($input['title']);
		$tag_id = createTagsFromSegments($tag_segments, '', $module);

		return data([
			'success' => true,
			'message' => 'Tag created successfully',
			'data' => [
				'tag_id' => $tag_id,
				'title' => $input['title'],
			]
		]);
	}
}