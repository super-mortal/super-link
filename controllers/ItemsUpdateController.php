<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Respect\Validation\Validator;
use function Framework\success;
use function Utils\processInputTags;

class ItemsUpdateController implements ControllerInterface
{
	public function validateInput(): Validator
	{
		return Validator::key('item-id', Validator::stringType()->notEmpty())
			->key('title', Validator::stringType()->notEmpty())
			->key('url', Validator::url()->setName('URL'))
			->key('description', Validator::stringType()->setName('Description'))
			->key('comments', Validator::stringType()->setName('Notes'))
			->key('tags', Validator::arrayType()->setName('Tags'));
	}

	public function __invoke(array $input): ResponseInterface
	{
		// Handle tags (can throw an excepion)
		$tag_ids = processInputTags($input['tags']);

		// Save item in DB
		$item_id = $_GET['item-id'];

		$repository = ServiceContainer::get(Repository::class);

		$result = $repository->updateItem($input['title'], $input['description'], $input['url'], $input['comments'], $item_id);
		if (!$result) {
			throw new DataWriteException('Item update failed');
		}

		$result = $repository->setItemTags($tag_ids, $item_id);

		if (!$result) {
			throw new DataWriteException('Item tags update failed');
		}

		return success('Item updated successfully', [
			'item_id' => $item_id,
		]);
	}
}