<?php

namespace Utils;

use DateTime;
use Exception;
use Framework\ServiceContainer;
use Models\Item;
use Models\ItemCreator;
use Models\Repository;
use Models\TagCreator;

class PocketImporter
{
	const COLLECTIONS_PARENT_TAG_NAME = 'Collections';
	const COLLECTIONS_PARENT_TAG_DESCRIPTION = 'Pocket collections';
	const STATUS_PARENT_TAG_NAME = 'Status';
	const STATUS_PARENT_TAG_DESCRIPTION = 'Pocket read status: unread or archive';
	const IMPORT_FROM_POCKET_TAG_NAME = 'Imported from Pocket';
	const IMPORTED_TAG_DESCRIPTION = 'Tag imported from Pocket';
	const NOTE_FROM_POCKET_COLLECTION_CAPTION = 'Note from Pocket collection "%s":' . "\n";

	public function __construct(protected Repository $repository, protected TagCreator $tag_creator)
	{
	}

	public function processFiles(string $temp_dir)
	{
		// Extract data from file
		[$collections, $collection_bookmarks] = $this->extractDataFromCollections($temp_dir);
		[$tags, $statuses, $bookmarks] = $this->extractDataFromLinks($temp_dir, $collection_bookmarks);

		$existing_tags = $this->repository->getTags();

		// Create tags from Pocket collections
		$collection_tag_map = [];
		if (!empty($collections)) {
			$collection_parent_tag_map = $this->writeTags($existing_tags, [self::COLLECTIONS_PARENT_TAG_NAME => self::COLLECTIONS_PARENT_TAG_DESCRIPTION], 0);
			$collection_parent_tag_id = $collection_parent_tag_map[self::COLLECTIONS_PARENT_TAG_NAME];
			$collection_tag_map = $this->writeTags($existing_tags, $collections, $collection_parent_tag_id);
		}

		// Create tags from Pocket tags
		$tag_map = $this->writeTags($existing_tags, $tags, 0);

		// Create tags from Pocket statuses
		$status_parent_tag_map = $this->writeTags($existing_tags, [self::STATUS_PARENT_TAG_NAME => self::STATUS_PARENT_TAG_DESCRIPTION], 0);
		$status_parent_tag_id = $status_parent_tag_map[self::STATUS_PARENT_TAG_NAME];
		$status_tag_map = $this->writeTags($existing_tags, $statuses, $status_parent_tag_id);

		// Save items to DB
		$items = $this->saveItems($bookmarks, $tag_map, $collection_tag_map, $status_tag_map);

		return count($items);
	}

	protected function extractDataFromCollections($temp_dir)
	{
		$collections_dir = $temp_dir . '/collections';
		if (!is_dir($collections_dir)) {
			return [[], []];
		}

		$collection_files = glob($collections_dir . '/*.json');
		$collection_bookmarks = [];
		foreach ($collection_files as $collection_file) {
			$collection_data = json_decode(file_get_contents($collection_file), true);

			if (!isset($collection_data['title'], $collection_data['items'])) {
				throw new Exception('Invalid collection data in file: ' . $collection_file);
			}

			$collection_title = $collection_data['title'];
			$collections[$collection_title] = $collection_data['description'] ?? '';

			$collection_bookmarks = array_reduce($collection_data['items'], function ($carry, $bookmark) use ($collection_title) {
				if (!isset($bookmark['url'], $bookmark['title'])) {
					throw new Exception('Invalid item data in collection: ' . json_encode($bookmark));
				}
				$url = $bookmark['url'];
				$carry[$url]['title'] = $bookmark['title'];
				$carry[$url]['excerpt'] = $bookmark['excerpt'] ?? '';
				$carry[$url]['notes'][$collection_title] = $bookmark['note'] ?? '';
				$carry[$url]['attached_collections'][] = $collection_title;
				return $carry;
			}, $collection_bookmarks);
		}
		return [$collections, $collection_bookmarks];
	}

	protected function extractDataFromLinks($temp_dir, $collection_bookmarks)
	{
		// Process main CSV file
		$csv_files = glob($temp_dir . '/part_*.csv');
		if (empty($csv_files)) {
			throw new Exception('No CSV files found in the archive');
		}

		// Process CSV with bookmarks
		foreach ($csv_files as $csv_file) {
			$handle = fopen($csv_file, 'r');

			if ($handle === false) {
				throw new Exception('Failed to open CSV file: ' . $csv_file);
			}

			// Skip header row
			$header = fgetcsv($handle, 0, ',', '"', '\\');
			$header_matches_format = $header === ['title', 'url', 'time_added', 'tags', 'status'];
			if (!$header_matches_format) {
				throw new Exception('Invalid CSV format in file: ' . $csv_file);
			}

			$bookmarks = [];
			$all_tags = [];
			$statuses = [];
			while (($data = fgetcsv($handle, 0, ',', '"', '\\')) !== false) {
				if (count($data) != 5) {
					throw new Exception('Invalid CSV row format in file: ' . $csv_file);
				}

				[$title, $url, $time_added, $tags, $status] = $data;
				$time_added = new DateTime('@' . $time_added);
				$tags = explode('|', $tags);
				$tags = array_filter($tags, fn($tag) => $tag !== '');
				$tags[] = self::IMPORT_FROM_POCKET_TAG_NAME;


				$notes = $collection_bookmarks[$url]['notes'] ?? [];
				$notes = array_filter($notes, fn($comment) => $comment !== '');
				if (count($notes) === 1) {
					$notes = array_values($notes)[0];
				} else {
					$notes = array_map(function ($comment, $collection_title) {
						return sprintf(self::NOTE_FROM_POCKET_COLLECTION_CAPTION, $collection_title) . $comment;
					}, $notes, array_keys($notes));
					$notes = implode("\n\n", $notes);

				}

				if (!empty($collection_bookmarks[$url]['title']) && $collection_bookmarks[$url]['title'] !== $url) {
					$title = $collection_bookmarks[$url]['title'];
				}

				$bookmarks[] = [
					'title' => $title,
					'excerpt' => $collection_bookmarks[$url]['excerpt'] ?? '',
					'url' => $url,
					'notes' => $notes,
					'collections' => $collection_bookmarks[$url]['attached_collections'] ?? [],
					'tags' => $tags,
					'status' => $status,
					'time_added' => $time_added,
				];

				$all_tags = array_reduce($tags, function ($carry, $tag_name) {
					$carry[$tag_name] = self::IMPORTED_TAG_DESCRIPTION;
					return $carry;
				}, $all_tags);
				$statuses[$status] = '';
			}
			fclose($handle);
		}

		return [$all_tags, $statuses, $bookmarks];
	}

	protected function writeTags($existing_tags, $tag_titles, $parent_tag_id)
	{
		$existing_tags = array_filter(
			$existing_tags,
			fn($tag) => $tag['parent'] === $parent_tag_id
		);
		$existing_tags = array_column($existing_tags, 'id', 'title');
		$existing_tags = array_change_key_case($existing_tags, CASE_LOWER);

		$tag_map = [];
		array_walk(
			$tag_titles,
			function ($tag_description, $tag_title) use ($existing_tags, $parent_tag_id, &$tag_map) {
				$tag_map[$tag_title] = $existing_tags[strtolower($tag_title)]
					?? $this->tag_creator->createTag($tag_title, $tag_description, $parent_tag_id);
			});

		return $tag_map;
	}

	protected function saveItems($bookmarks, $tag_map, $collection_map, $status_map)
	{
		$items = array_map(function ($bookmark) use ($tag_map, $collection_map, $status_map) {
			$tag_ids = array_merge(
				array_intersect_key($tag_map, array_flip($bookmark['tags'])),
				array_intersect_key($collection_map, array_flip($bookmark['collections'])),
				array_intersect_key($status_map, array_flip([$bookmark['status']])),
			);

			return new Item (
				$bookmark['url'],
				$bookmark['title'],
				$bookmark['excerpt'],
				'',
				$bookmark['notes'],
				$tag_ids,
				$bookmark['time_added'],
			);

		}, $bookmarks);

		$item_creator = ServiceContainer::get(ItemCreator::class);
		return $item_creator->createItems($items);
	}
}