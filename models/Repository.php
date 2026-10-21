<?php

namespace Models;

use Exception;
use PDO;

class Repository
{
	private $pdo;

	public function __construct($pdo)
	{
		$this->pdo = $pdo;
	}

	public function getTags()
	{
		$tags = [];
		$stmt = $this->pdo->query('SELECT * FROM tags ORDER BY title ASC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$tags[(int)$row['id']] = $row;
		}
		return $tags;
	}

	public function getItems()
	{
		$items_tags = $this->getItemsTags();

		$items = [];
		$stmt = $this->pdo->query('SELECT * FROM items ORDER BY id DESC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$item_id = (int)$row['id'];
		$items[$item_id] = array_merge($row, [
			'url' => urldecode($row['url']),
			'tags' => $items_tags[$item_id] ?? []
		]);
		}
		return $items;
	}

	/**
	 * Get items tags relation
	 */
	public function getItemsTags()
	{
		$items_tags = [];
		$stmt = $this->pdo->query('SELECT item_id, tag_id FROM items_tags ORDER BY tag_id ASC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$items_tags[(int)$row['item_id']][] = (int)$row['tag_id'];
		}
		return $items_tags;
	}

	public function getItemsUrls(array $item_ids)
	{
		if (empty($item_ids)) {
			return [];
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare("SELECT id, url FROM items WHERE id IN ($sql_in)");
		$stmt->execute($item_ids);

		$items = [];
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$items[(int)$row['id']] = urldecode($row['url']);
		}
		return $items;
	}

	public function getSkills()
	{
		$skills_tags = $this->getSkillTags();

		$skills = [];
		$stmt = $this->pdo->query('SELECT * FROM skills ORDER BY id DESC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$skill_id = (int)$row['id'];
			$skills[$skill_id] = array_merge($row, [
				'tags' => $skills_tags[$skill_id] ?? []
			]);
		}
		return $skills;
	}

	public function getSkill(int $skill_id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM skills WHERE id = :skill_id');
		$stmt->execute([':skill_id' => $skill_id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	public function getSkillByName(string $name)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM skills WHERE name = :name');
		$stmt->execute([':name' => $name]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * Get skills tags relation
	 */
	public function getSkillTags()
	{
		$skills_tags = [];
		$stmt = $this->pdo->query('SELECT skill_id, tag_id FROM skills_tags ORDER BY tag_id ASC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$skills_tags[(int)$row['skill_id']][] = (int)$row['tag_id'];
		}
		return $skills_tags;
	}

	public function createSkill(array $data)
	{
		$stmt = $this->pdo->prepare(
			'INSERT INTO skills (name, description, source_type, source_url, fingerprint, installed_at, updated_at)
			VALUES (:name, :description, :source_type, :source_url, :fingerprint, :installed_at, :updated_at)'
		);
		$date = date('Y-m-d H:i:s');
		$stmt->execute([
			':name' => $data['name'],
			':description' => $data['description'] ?? '',
			':source_type' => $data['source_type'],
			':source_url' => $data['source_url'] ?? '',
			':fingerprint' => $data['fingerprint'] ?? '',
			':installed_at' => $data['installed_at'] ?? $date,
			':updated_at' => $data['updated_at'] ?? $date,
		]);
		return $this->pdo->lastInsertId();
	}

	public function updateSkillMeta(int $id, string $description, string $source_url)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE skills
			SET description = :description, source_url = :source_url, updated_at = :updated_at
			WHERE id = :id'
		);
		return $stmt->execute([
			':description' => $description,
			':source_url' => $source_url,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $id,
		]);
	}

	public function updateSkillFingerprint(int $id, string $fingerprint)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE skills
			SET fingerprint = :fingerprint, updated_at = :updated_at
			WHERE id = :id'
		);
		return $stmt->execute([
			':fingerprint' => $fingerprint,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $id,
		]);
	}

	public function deleteSkill(int $id)
	{
		// foreign_keys pragma is off, so clean relations manually
		$this->deleteSkillsTags([$id], []);

		$stmt = $this->pdo->prepare('DELETE FROM skills WHERE id = :id');
		return $stmt->execute([':id' => $id]);
	}

	public function setSkillTags(array $tag_ids, int $skill_id): bool
	{
		// 1. delete all tags relations
		$result = $this->deleteSkillsTags([$skill_id], []);
		if (false === $result) {
			return false;
		}

		// 2. insert new tags relations
		return $this->attachSkillTags([$skill_id], $tag_ids);
	}

	public function deleteSkillsTags(array $skill_ids, array $except_tag_ids): bool
	{
		if (empty($skill_ids)) {
			return false;
		}
		$sql_in_skill_ids = implode(',', array_fill(0, count($skill_ids), '?'));
		$sql_data = $skill_ids;

		if (!empty($except_tag_ids)) {
			$sql_not_in_tag_ids = implode(',', array_fill(0, count($except_tag_ids), '?'));
			$sql_not_in_tag_ids = " AND tag_id NOT IN ($sql_not_in_tag_ids)";
			$sql_data = array_merge($sql_data, $except_tag_ids);
		} else {
			$sql_not_in_tag_ids = '';
		}
		$stmt = $this->pdo->prepare("DELETE FROM skills_tags
		WHERE skill_id IN ($sql_in_skill_ids)
		$sql_not_in_tag_ids");
		return $stmt->execute($sql_data);
	}

	public function attachSkillTags(array $skill_ids, array $tag_ids): bool
	{
		if (empty($tag_ids)) {
			return true;
		}

		$sql_data = [];

		foreach ($skill_ids as $skill_id) {
			foreach ($tag_ids as $tag_id) {
				array_push($sql_data, $skill_id, (int)$tag_id);
			}
		}

		$sql = 'INSERT
		INTO skills_tags (skill_id, tag_id)
		VALUES ' . implode(',', array_fill(0, count($sql_data) / 2, '(?, ?)'));
		$stmt = $this->pdo->prepare($sql);
		return $stmt->execute($sql_data);
	}

	public function refreshSkillsUpdatedAt(array $skill_ids)
	{
		if (empty($skill_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($skill_ids), '?'));
		$stmt = $this->pdo->prepare(
			"UPDATE skills
			SET updated_at = ?
			WHERE id IN ($sql_in)"
		);
		return $stmt->execute([
			date('Y-m-d H:i:s'),
			...$skill_ids,
		]);
	}

	public function getUser(int $user_id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM users WHERE id = :user_id');
		$stmt->execute([':user_id' => $user_id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	public function getUserByUsername(string $username)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM users WHERE username = :username');
		$stmt->execute([':username' => $username]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	public function userTableNotEmpty(): bool
	{
		$stmt = $this->pdo->query('SELECT 1 FROM users');
		return (bool)$stmt->fetchColumn();
	}

	public function createUser(string $username, string $password_hash)
	{
		$stmt = $this->pdo->prepare(
			'INSERT INTO users (username, password_hash, created_at, updated_at) 
			VALUES (:username, :password_hash, :created_at, :updated_at)'
		);
		$date = date('Y-m-d H:i:s');
		$stmt->execute([
			':username' => $username,
			':password_hash' => $password_hash,
			':created_at' => $date,
			':updated_at' => $date,
		]);
		return $this->pdo->lastInsertId();
	}

	public function deleteUser(int $user_id)
	{
		$stmt = $this->pdo->prepare('DELETE FROM users WHERE id = :user_id');
		return $stmt->execute([':user_id' => $user_id]);
	}

	public function updateUsername(int $user_id, string $username)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE users SET username = :username, updated_at = :updated_at WHERE id = :id'
		);
		return $stmt->execute([
			':username' => $username,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $user_id,
		]);
	}

	public function updatePasswordHash(int $user_id, string $password_hash)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE users SET password_hash = :password_hash, updated_at = :updated_at WHERE id = :id'
		);
		return $stmt->execute([
			':password_hash' => $password_hash,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $user_id,
		]);
	}

	public function setItemTags(array $tag_ids, int $item_id): bool
	{
		// 1. delete all tags relations
		$result = $this->deleteItemsTags([$item_id], []);
		if (false === $result) {
			return false;
		}

		// 2. insert new tags relations
		return $this->attachItemsTags([$item_id], $tag_ids);
	}

	public function deleteItemsTags(array $item_ids, array $except_tag_ids): bool
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in_item_ids = implode(',', array_fill(0, count($item_ids), '?'));
		$sql_data = $item_ids;

		if (!empty($except_tag_ids)) {
			$sql_not_in_tag_ids = implode(',', array_fill(0, count($except_tag_ids), '?'));
			$sql_not_in_tag_ids = " AND tag_id NOT IN ($sql_not_in_tag_ids)";
			$sql_data = array_merge($sql_data, $except_tag_ids);
		} else {
			$sql_not_in_tag_ids = '';
		}
		$stmt = $this->pdo->prepare("DELETE FROM items_tags 
		WHERE item_id IN ($sql_in_item_ids)
		$sql_not_in_tag_ids");
		return $stmt->execute($sql_data);
	}

	public function attachItemsTags(array $item_ids, array $tag_ids): bool
	{
		if (empty($tag_ids)) {
			return true;
		}

		$sql_data = [];

		foreach ($item_ids as $item_id) {
			foreach ($tag_ids as $tag_id) {
				array_push($sql_data, $item_id, (int)$tag_id);
			}
		}

		$sql = 'INSERT  
		INTO items_tags (item_id, tag_id) 
		VALUES ' . implode(',', array_fill(0, count($sql_data) / 2, '(?, ?)'));
		$stmt = $this->pdo->prepare($sql);
		return $stmt->execute($sql_data);
	}

	public function refreshItemsUpdatedAt($item_ids)
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare(
			"UPDATE items 
			SET updated_at = ?
    		WHERE id IN ($sql_in)"
		);
		return $stmt->execute([
			date('Y-m-d H:i:s'),
			...$item_ids,
		]);
	}

	public function updateItem($title, $description, $url, $comments, $item_id): bool
	{
		$stmt = $this->pdo->prepare(
			'UPDATE items
			SET title = :title, description = :description, url = :url, comments = :comments, updated_at = :updated_at
    		WHERE id = :id'
		);
		$result = $stmt->execute([
			':title' => $title,
			':description' => $description,
			':url' => $url,
			':comments' => $comments,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $item_id,
		]);
		return $result && !!$stmt->rowCount();
	}

	public function updateItemsMetadata($title, $description, $item_ids)
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare(
			"UPDATE items
			SET title = ?,
				description = ?,
				updated_at = ?
    		WHERE id IN ($sql_in)"
		);
		return $stmt->execute([
			$title,
			$description,
			date('Y-m-d H:i:s'),
			...$item_ids,
		]);
	}


	public function updateTag($tag_id, string $title, string $description, int $parent_id)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE tags 
			SET title = :title, 
			description = :description, 
			parent = :parent, 
			updated_at = :updated_at
			WHERE id = :id'
		);

		return $stmt->execute([
			':title' => $title,
			':description' => $description,
			':parent' => $parent_id,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $tag_id
		]);
	}

	public function updateTagColor($tag_id, $color)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE tags 
			SET color = :color,
			updated_at = :updated_at
			WHERE id = :id'
		);

		return $stmt->execute([
			':color' => $color,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $tag_id
		]);
	}

	public function updateTagPinned($tag_id, bool $pinned)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE tags 
			SET pinned = :pinned,
			updated_at = :updated_at
			WHERE id = :id'
		);

		return $stmt->execute([
			':pinned' => (int)$pinned,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $tag_id
		]);
	}

	public function deleteTagsItemAttachment(array $tag_ids)
	{
		if (empty($tag_ids)) {
			return false;
		}

		$sql_in = implode(',', array_fill(0, count($tag_ids), '?'));
		$stmt = $this->pdo->prepare("DELETE FROM items_tags 
		WHERE tag_id IN ($sql_in)");

		return $stmt->execute($tag_ids);

	}

	public function deleteTags(array $tag_ids)
	{
		if (empty($tag_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($tag_ids), '?'));

		$stmt = $this->pdo->prepare("DELETE FROM tags 
		WHERE id IN ($sql_in)");

		return $stmt->execute($tag_ids);

	}


	public function deleteItems(array $item_ids): bool
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare("DELETE FROM items WHERE id IN ($sql_in)");

		return $stmt->execute($item_ids);

	}

	/**
	 * Check if database tables exist
	 *
	 * @return bool
	 */
	public function checkDatabaseExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='items'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Set up database tables
	 *
	 * @return bool
	 */
	public function setupDatabase()
	{
		try {
			// Create items table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS items (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				url TEXT NOT NULL,
				comments TEXT NOT NULL,
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');

			// Create tags table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS tags (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			   title TEXT NOT NULL,
			   description TEXT NOT NULL,
			   color TEXT NOT NULL,
			   parent INTEGER NOT NULL DEFAULT(0),
			   pinned INTEGER NOT NULL DEFAULT(0),
			   created_at TEXT DEFAULT(NULL),
			   updated_at TEXT DEFAULT(NULL)
			)');

			// Create items_tags relationship table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS items_tags (
				item_id INTEGER NOT NULL,
				tag_id INTEGER NOT NULL,
				PRIMARY KEY(item_id, tag_id) 
				FOREIGN KEY(item_id) REFERENCES items(id) 
				ON DELETE CASCADE 
				FOREIGN KEY(tag_id) REFERENCES tags(id) 
				ON DELETE CASCADE
			)');

			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	public function migrate()
	{
		if (!$this->checkUsersTableExists() && !$this->setupUsersTable()) {
			throw new Exception('Failed to set up users table');
		}

		if (!$this->checkSkillsTableExists() && !$this->setupSkillsTable()) {
			throw new Exception('Failed to set up skills table');
		}

		if (!$this->checkSkillsTagsTableExists() && !$this->setupSkillsTagsTable()) {
			throw new Exception('Failed to set up skills_tags table');
		}

		if (!$this->checkTagIndexExists() && !$this->createTagIndex()) {
			throw new Exception('Failed to create index on tags');
		}

		// Drop the legacy image column if it still exists (image feature removed)
		if ($this->checkItemsImageColumnExists()) {
			$this->dropItemsImageColumn();
		}
	}

	/**
	 * Check if the legacy image column still exists on the items table
	 */
	public function checkItemsImageColumnExists(): bool
	{
		try {
			$stmt = $this->pdo->query('SELECT image FROM items LIMIT 1');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	public function dropItemsImageColumn(): bool
	{
		try {
			$this->pdo->exec('ALTER TABLE items DROP COLUMN image');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Check if users table exists
	 *
	 * @return bool
	 */
	public function checkUsersTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	public function setupUsersTable()
	{
		try {
			// Create users table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS users (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				username TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Check if skills table exists
	 *
	 * @return bool
	 */
	public function checkSkillsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	public function setupSkillsTable()
	{
		try {
			// Create skills table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS skills (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL UNIQUE,
				description TEXT NOT NULL DEFAULT \'\',
				source_type TEXT NOT NULL,
				source_url TEXT NOT NULL DEFAULT \'\',
				fingerprint TEXT NOT NULL DEFAULT \'\',
				installed_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Check if skills_tags table exists
	 *
	 * @return bool
	 */
	public function checkSkillsTagsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='skills_tags'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	public function setupSkillsTagsTable()
	{
		try {
			// Create skills_tags relationship table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS skills_tags (
				skill_id INTEGER NOT NULL,
				tag_id INTEGER NOT NULL,
				PRIMARY KEY(skill_id, tag_id),
				FOREIGN KEY(skill_id) REFERENCES skills(id)
				ON DELETE CASCADE,
				FOREIGN KEY(tag_id) REFERENCES tags(id)
				ON DELETE CASCADE
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	public function checkTagIndexExists()
	{
		$stmt = $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_tags_title_parent' AND tbl_name = 'tags';");
		return (bool)$stmt->fetchColumn();

	}

	public function createTagIndex()
	{
		try {
			$this->pdo->exec('CREATE UNIQUE INDEX "idx_tags_title_parent" ON tags(title COLLATE NOCASE ASC, parent COLLATE BINARY ASC);');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}
}
