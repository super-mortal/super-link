<?php

namespace Models;

class TagCreator
{
	private $pdo;
	private $stmt;

	/**
	 * 新建标签（不显式写 module，依赖 tags.module 列默认值 'bookmarks'）
	 *
	 * 唯一索引已改为 (module, title, parent)（PRD O-9），书签侧创建语义与模块
	 * 隔离前完全一致；Skill 侧创建时需由调用方显式落 module='skills' 的标签，
	 * 属于标签接口改造范围，数据层迁移（Repository::migrate()）不牵连写入方。
	 */
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