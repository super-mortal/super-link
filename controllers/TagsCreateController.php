<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use function Framework\data;
use function Utils\createTagsFromSegments;
use function Utils\extractTagSegments;

class TagsCreateController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		if (!isset($input['title'])) {
			throw new ValidationException('Invalid input data for tag create.');
		}

		$tag_segments = extractTagSegments($input['title']);
		$tag_id = createTagsFromSegments($tag_segments);

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