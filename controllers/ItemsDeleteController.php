<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;

class ItemsDeleteController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$item_ids = $input['item-ids'] ?? null;

		if (empty($item_ids) || !is_array($item_ids)) {
			throw new ValidationException('Item IDs not provided or invalid');
		}

		$repository = ServiceContainer::get(Repository::class);;

		$result = $repository->deleteItemsTags($item_ids, []);

		if (false === $result) {
			throw new DataWriteException('Failed to delete item tags');
		}

		$result = $repository->deleteItems($item_ids);

		if (false === $result) {
			throw new DataWriteException('Failed to delete items');
		}

		$items_count = count($item_ids);

		return success(
			($items_count == 1 ? 'Item' : "$items_count items") . ' deleted successfully',
			['item-ids' => $item_ids]
		);
	}
}