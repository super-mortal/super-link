<?php

namespace Models;

class ItemCreator
{
	private $pdo;

	public function __construct(\PDO $pdo)
	{
		$this->pdo = $pdo;
	}

	public function createItems(array $items): array
	{
		if (empty($items)) {
			throw new \InvalidArgumentException('No items provided for creation.');
		}

		$this->pdo->beginTransaction();

		$stmt = $this->pdo->prepare(
			'INSERT INTO items (title, description, url, comments, created_at)
    VALUES (:title, :description, :url, :comments, :created_at)'
		);

		array_walk($items, function ($item) use (&$stmt) {
			$item_id = $this->execCreateItemStatement(
				$item,
				$stmt,
			);
			$item->setID($item_id);
		});

		$this->attachItemsTags($items);

		$this->pdo->commit();

		return $items;
	}

	protected function execCreateItemStatement(Item $item, $stmt)
	{
		$date_format = 'Y-m-d H:i:s';

		$stmt->execute([
			':title' => $item->title,
			':description' => $item->description,
			':url' => $item->url,
			':comments' => $item->notes,
			':created_at' => $item->created_at ? $item->created_at->format($date_format) : date($date_format),
		]);

		return $this->pdo->lastInsertId();
	}

	protected function attachItemsTags(array $items): bool
	{
		$sql_data = [];

		foreach ($items as $item) {
			foreach ($item->tag_ids as $tag_id) {
				array_push($sql_data, $item->id, (int)$tag_id);
			}
		}

		if (empty($sql_data)) {
			return true; // No tags to attach, consider it a success
		}

		$sql = 'INSERT  
		INTO items_tags (item_id, tag_id) 
		VALUES ' . implode(',', array_fill(0, count($sql_data) / 2, '(?, ?)'));
		$stmt = $this->pdo->prepare($sql);

		return $stmt->execute($sql_data);
	}
}