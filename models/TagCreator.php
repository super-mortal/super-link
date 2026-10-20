<?php

namespace Models;

class TagCreator
{
	private $pdo;
	private $stmt;

	public function __construct(\PDO $pdo)
	{
		$this->pdo = $pdo;
		$this->stmt = $pdo->prepare(
			'INSERT INTO tags (title, description, color, parent, pinned, created_at) 
			VALUES (:title, :description, :color, :parent, :pinned, :created_at)'
		);
	}

	public function createTag(string $tag_title, string $tag_description, int $tag_parent, $color = 'gray', bool $pinned = false)
	{
		$this->stmt->execute([
			':title' => $tag_title,
			':description' => $tag_description,
			':color' => $color,
			':parent' => $tag_parent,
			':pinned' => (int) $pinned,
			':created_at' => date('Y-m-d H:i:s')
		]);

		return $this->pdo->lastInsertId();
	}
}