<?php

namespace Controllers;

use ErrorException;
use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\DOMParser;
use function Framework\success;
use function Utils\fetchMultiplePageHTML;

class ItemsFetchMetadataController implements ControllerInterface
{

	public function __invoke(array $input): ResponseInterface
	{
		$item_ids = $input['item-ids'] ?? null;

		if (empty($item_ids) || !is_array($item_ids)) {
			throw new ValidationException('Item IDs not provided or invalid');
		}

		$repository = ServiceContainer::get(Repository::class);
		$items_urls = $repository->getItemsUrls($item_ids);

		[$pages, $failed_reasons] = fetchMultiplePageHTML($items_urls);
		// Extract metadata from fetched pages HTML
		$metadata = [];
		array_walk($pages, function ($body, $url) use (&$metadata, &$failed_reasons) {
			$parser = new DOMParser($body);
			$title = $parser->extractTitle();
			$description = $parser->extractDescription();

			if (!isset($title) && !isset($description)) {
				$failed_reasons[$url] = 'Failed to extract metadata';
				return;
			}
			$metadata[$url] = [$title, $description];
		});
		unset($pages);


		$updated_items_count = 0;
		array_walk($metadata,
			function ($data, $url) use ($items_urls, &$updated_items_count, &$failed_reasons, $repository) {
				$item_ids = array_keys($items_urls, $url);
				[$title, $description] = $data;
				$result = $repository->updateItemsMetadata($title ?? '', $description ?? '', $item_ids);
				if (false === $result) {
					$failed_reasons[$url] = 'Failed to update item metadata in database';
					return;
				}

				$updated_items_count += count($item_ids);
			});

		$failed_items_count = count($items_urls) - $updated_items_count;
		$message_parts = [];
		if ($updated_items_count > 0) {
			$message_parts[] = "Successfully refetched $updated_items_count " . ($updated_items_count === 1 ? 'item' : 'items');
		}

		if ($failed_items_count > 0) {
			$message_parts[] = "Failed to refetch $failed_items_count " . ($updated_items_count === 1 ? 'item' : 'items');
			// TODO: Include failed reasons in the message
			/*$message_parts = array_merge($message_parts, array_map(
				fn ($url, $reason) => "$url: $reason",
				array_keys($failed_reasons),
				$failed_reasons
			));*/
		}
		$message = implode(". ", $message_parts);

		if ($updated_items_count === 0) {
			throw new ErrorException($message);
		}

		return success($message);
	}
}