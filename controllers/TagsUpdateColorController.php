<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;
use function Utils\getTagColors;

class TagsUpdateColorController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		if (!isset($input['tag-id'], $input['color']) || !in_array($input['color'], getTagColors())) {
			throw new ValidationException('Invalid input data for tag color update.');
		}

		$tag_id = $input['tag-id'];

		$repository = ServiceContainer::get(Repository::class);

		$repository->updateTagColor(
			$tag_id,
			$input['color']
		);

		return data([
			'success' => true,
			'message' => 'Tag color updated successfully',
			'data' => [
				'tag_id' => $tag_id,
				'color' => $input['color'],
			]
		]);
	}
}