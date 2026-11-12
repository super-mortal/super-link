<?php

namespace Models;

class TagCreator
{
	private $pdo;
	private $stmt;

	/**
	 * 新建标签（PRD O-9：module 区分书签 / Skill 两本字典，默认 'bookmarks'）
	 *
	 * 唯一索引是 (module, title, parent)：同名标签可以分别存在于两个模块而互不冲突。
	 * 调用方按当前模块显式传 $module；不传时保持迁移前的 bookmarks 语义
	 * （欢迎内容、书签导入等历史调用方都是书签侧，无需改动）。
	 */
	public function __construct(\PDO $pdo)
	{
		$this->pdo = $pdo;
		$this->stmt = $pdo->prepare(
			'INSERT INTO tags (title, description, color, parent, pinned, module, created_at)
			VALUES (:title, :description, :color, :parent, :pinned, :module, :created_at)'
		);
	}

	public function createTag(string $tag_title, string $tag_description, int $tag_parent, $color = 'gray', bool $pinned = false, string $module = 'bookmarks')
	{
		$this->stmt->execute([
			':title' => $tag_title,
			':description' => $tag_description,
			':color' => $color,
			':parent' => $tag_parent,
			':pinned' => (int) $pinned,
			':module' => $module,
			':created_at' => date('Y-m-d H:i:s')
		]);

		return $this->pdo->lastInsertId();
	}
}