<?php

namespace Utils;

use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use PDO;
use PDOStatement;
use Throwable;

/**
 * 书签恢复器（refinements.md §4.3 / dev-spec §6.2、§6.5）
 *
 * 为什么单独成类：新端点 /api/backup/bookmarks/restore 与旧 /api/import/data
 * 必须共用同一份「解析 → 校验 → 标签 ID 重映射 → 写库」逻辑（dev-spec §4 的
 * 兼容口径是旧端点内部改调新逻辑）。两处各写一份必然漂移：旧导入把标签映射、
 * 父级多轮解析与 URL 归一都嵌在控制器里，新端点再抄一遍就会出现「同名标签在
 * 新旧端点表现不同」这类只在线上暴露的问题。
 *
 * 预检（dry_run）与执行严格分流：dry_run 只做 SELECT 与内存分类后提前 return，
 * 不开事务、绝不写库（dev-spec §4「dry_run 绝不写库」）。
 *
 * 写库方式与旧 ImportDataController 一致，直接走预处理语句 + 单事务：
 * 现有 Repository / TagCreator / ItemCreator 都是「单条写」且 ItemCreator 自带
 * 事务，无法在同一事务里批量重建并保持逐条结果，故沿用参考实现的直写形态。
 */
class BookmarkRestorer
{
	public const MODE_MERGE = 'merge';
	public const MODE_OVERWRITE = 'overwrite';

	private PDO $pdo;

	public function __construct(PDO $pdo)
	{
		$this->pdo = $pdo;
	}

	/**
	 * 解析并校验备份文件内容，返回规范化后的数据（tags / items 均重排为顺序数组）
	 *
	 * @param string $content                上传文件的原始字节
	 * @param bool   $allow_missing_module   仅旧端点 /api/import/data 传 true：历史导出
	 *                                       文件不带 module（dev-spec §6.5 的唯一例外），
	 *                                       此处补默认 'bookmarks'；新恢复端点必须严格
	 *                                       校验 module，不得下沉复用该默认值。
	 *
	 * 所有失败都在这里抛出 ValidationException(400)，因此预检与执行都会在写库前
	 * 被拦截（空文件 / JSON 解析失败 / 缺 module / module 不匹配 / 版本不支持 /
	 * 缺 tags / items / 条目缺 URL 或标题 / 标签缺 id 或标题）。
	 */
	public function parse(string $content, bool $allow_missing_module = false): array
	{
		if (trim($content) === '') {
			throw new ValidationException('恢复失败：备份文件为空', 400);
		}

		$data = json_decode($content, true);
		if (json_last_error() !== JSON_ERROR_NONE) {
			throw new ValidationException('恢复失败：备份文件不是有效的 JSON', 400);
		}
		if (!is_array($data)) {
			throw new ValidationException('恢复失败：备份文件格式不正确', 400);
		}

		// module：备份文件必须明确属于书签模块；旧端点允许缺失（历史文件不带该字段）
		if (!isset($data['module']) || $data['module'] === '') {
			if (!$allow_missing_module) {
				throw new ValidationException('恢复失败：缺少 module 字段', 400);
			}
			$data['module'] = 'bookmarks';
		}
		if ($data['module'] !== 'bookmarks') {
			throw new ValidationException('恢复失败：备份文件不属于书签模块', 400);
		}

		// version：只接受当前格式版本（dev-spec §6.1）；高版本可能在字段语义上不兼容
		$version = $data['version'] ?? null;
		if (!is_int($version) && !(is_string($version) && ctype_digit($version))) {
			throw new ValidationException('恢复失败：缺少或非法的 version 字段', 400);
		}
		$version = (int)$version;
		if ($version < 1 || $version > BackupPayload::VERSION) {
			throw new ValidationException("恢复失败：不支持的备份版本 {$version}", 400);
		}
		$data['version'] = $version;

		if (!isset($data['tags']) || !is_array($data['tags'])) {
			throw new ValidationException('恢复失败：缺少 tags 字段', 400);
		}
		if (!isset($data['items']) || !is_array($data['items'])) {
			throw new ValidationException('恢复失败：缺少 items 字段', 400);
		}

		// 逐条校验标签：id 用于条目 tag_ids 的旧 → 新映射，title 是唯一索引的一部分，
		// 缺任一都无法可靠恢复，按「缺字段」在预检阶段 400，不进入写库分支
		foreach ($data['tags'] as $index => $tag) {
			if (!is_array($tag) || !isset($tag['id']) || (int)$tag['id'] <= 0) {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个标签缺少 id', 400);
			}
			if (!isset($tag['title']) || !is_string($tag['title']) || trim($tag['title']) === '') {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个标签缺少标题', 400);
			}
		}

		// 逐条校验书签：URL 是判重键，标题是 items.title NOT NULL 的必填列
		foreach ($data['items'] as $index => $item) {
			if (!is_array($item)) {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个书签格式不正确', 400);
			}
			if (!isset($item['url']) || !is_string($item['url']) || trim($item['url']) === '') {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个书签缺少 URL', 400);
			}
			if (!isset($item['title']) || !is_string($item['title'])) {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个书签缺少标题', 400);
			}
			if (isset($item['tag_ids']) && !is_array($item['tag_ids'])) {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个书签的 tag_ids 格式不正确', 400);
			}
		}

		// 统一重排为顺序数组：备份文件里 tags / items 理论上都是数组，
		// 但历史文件可能写成对象（JSON object），array_values 让后续遍历行为一致
		$data['tags'] = array_values($data['tags']);
		$data['items'] = array_values($data['items']);

		return $data;
	}

	/**
	 * 预检或执行恢复
	 *
	 * @param array  $payload parse() 的返回值
	 * @param string $mode    merge（按 URL 判重，已存在跳过）/ overwrite（清空书签重建）
	 * @param bool   $dry_run true 只返回分类与逐条预览，不写库
	 *
	 * 返回：{ dry_run, mode, summary: { new, same, skipped, failed }, items, tags }
	 * tags 为标签统计（new / same），旧端点 /api/import/data 拼历史文案时使用；
	 * 预检阶段不做标签写入模拟，统一返回 0。
	 */
	public function restore(array $payload, string $mode = self::MODE_MERGE, bool $dry_run = false): array
	{
		if (!in_array($mode, [self::MODE_MERGE, self::MODE_OVERWRITE], true)) {
			throw new ValidationException('恢复失败：mode 只能是 merge 或 overwrite', 400);
		}

		// 预检：只读（existingUrlSet 是 SELECT），分类完成后直接返回，
		// 后面的开启事务与写入语句全部不会执行
		if ($dry_run) {
			return $this->preview($payload, $mode);
		}

		$this->pdo->beginTransaction();
		try {
			// 覆盖模式：只清书签范围（items / items_tags / module='bookmarks' 的标签），
			// Skill 标签属于另一本字典，必须原样保留（refinements.md §4.3）
			if ($mode === self::MODE_OVERWRITE) {
				$this->clearBookmarks();
			}

			// 标签先重建：条目的 tag_ids 需要旧 id → 新 id 的映射才能挂载；
			// merge 模式下同名（module/title/parent 相同）标签复用已有行
			$tagResult = $this->rebuildTags($payload['tags']);

			$itemResult = $this->insertItems($payload['items'], $tagResult['map'], $mode);

			$this->pdo->commit();
		} catch (Throwable $e) {
			$this->pdo->rollBack();
			if ($e instanceof ValidationException) {
				throw $e;
			}
			// 不把底层 SQL 错误原文回给前端，避免暴露表结构；原因保留在 previous 里
			throw new DataWriteException('恢复失败：写入数据库时出错', 500, $e);
		}

		return [
			'dry_run' => false,
			'mode' => $mode,
			'summary' => [
				'new' => $itemResult['new'],
				'same' => $itemResult['same'],
				'skipped' => $itemResult['skipped'],
				'failed' => $itemResult['failed'],
			],
			'items' => $itemResult['items'],
			'tags' => [
				'new' => $tagResult['new'],
				'same' => $tagResult['same'],
			],
		];
	}

	/**
	 * 预检：分类书签并给出逐条预览，不写库
	 *
	 * 分类口径：
	 *   - overwrite：现有数据会被整体清空后重建，因此全部条目都算 new；
	 *   - merge：数据库已有该 URL（归一后）→ same；同文件内重复出现的 URL
	 *     在第一条之后也算 same；其余 → new。
	 * skipped / failed 在书签恢复里没有具体来源（GitHub 拉取失败属 Skill 恢复），
	 * 保留字段并置 0，以对齐 dev-spec §6.5 的响应契约。
	 */
	private function preview(array $payload, string $mode): array
	{
		$existing = $mode === self::MODE_MERGE ? $this->existingUrlSet() : [];

		$new = 0;
		$same = 0;
		$items = [];

		foreach ($payload['items'] as $item) {
			$url = (string)$item['url'];
			$normalized = $this->normalizeUrl($url);

			if ($mode === self::MODE_OVERWRITE) {
				$status = 'new';
				$new++;
			} elseif (isset($existing[$normalized])) {
				$status = 'same';
				$same++;
			} else {
				$status = 'new';
				$new++;
				// 文件内重复 URL：第一条算新增后，后续同类也应判为同名
				$existing[$normalized] = true;
			}

			$items[] = ['name' => $url, 'status' => $status];
		}

		return [
			'dry_run' => true,
			'mode' => $mode,
			'summary' => [
				'new' => $new,
				'same' => $same,
				'skipped' => 0,
				'failed' => 0,
			],
			'items' => $items,
			'tags' => ['new' => 0, 'same' => 0],
		];
	}

	/**
	 * 覆盖模式清空书签范围
	 *
	 * items / items_tags 只属于书签模块（items 表没有 module 列，Skill 有自己的
	 * skills / skills_tags 表），所以可以整体清空；tags 必须带 module='bookmarks'
	 * 条件，否则会把 Skill 标签一起删掉，Skill 侧标签引用随之悬空。
	 */
	private function clearBookmarks(): void
	{
		$this->pdo->exec('DELETE FROM items_tags');
		$this->pdo->exec('DELETE FROM items');
		$this->pdo->exec("DELETE FROM tags WHERE module = 'bookmarks'");
	}

	/**
	 * 重建标签并返回旧 id → 新 id 映射
	 *
	 * 父级不能假设拓扑序：备份里父标签可能排在子标签之后，所以按「父已解析或为根」
	 * 分多轮插入，每轮至少推进一个；轮数上限取标签数 + 1，用于跳出循环引用
	 * （A→B→A）。最终仍未解析的标签（父 id 在文件中不存在 / 成环）按孤儿处理，
	 * 落到根级（parent=0），否则会因唯一索引冲突或悬空 parent 无法插入。
	 *
	 * merge 模式：module/title/parent 已存在（唯一索引 idx_tags_module_title_parent）
	 * 直接复用，并记录到映射表，保证条目仍能挂到正确的新标签上。
	 *
	 * @return array{map: array<int,int>, new: int, same: int}
	 */
	private function rebuildTags(array $tags): array
	{
		$insertStmt = $this->pdo->prepare(
			'INSERT INTO tags (title, description, color, parent, pinned, module, created_at, updated_at)
			 VALUES (:title, :description, :color, :parent, :pinned, :module, :created_at, :updated_at)'
		);
		$checkStmt = $this->pdo->prepare(
			"SELECT id FROM tags WHERE module = 'bookmarks' AND title = :title AND parent = :parent"
		);

		$map = [];
		$pending = [];
		foreach ($tags as $tag) {
			$pending[] = $tag;
		}

		$created = 0;
		$reused = 0;
		$maxIterations = count($pending) + 1;

		for ($iteration = 0; $iteration < $maxIterations && !empty($pending); $iteration++) {
			$next = [];
			$progress = false;

			foreach ($pending as $tag) {
				$oldId = (int)$tag['id'];
				$oldParent = (int)($tag['parent'] ?? 0);

				if ($oldParent !== 0 && !isset($map[$oldParent])) {
					// 父标签还没建出来，留到下一轮
					$next[] = $tag;
					continue;
				}

				$newParent = $oldParent === 0 ? 0 : $map[$oldParent];
				// 旧 id 可能重复（损坏文件），后写覆盖先写——都指向同一个新标签即可
				$map[$oldId] = $this->ensureTag($checkStmt, $insertStmt, $tag, $newParent, $created, $reused);
				$progress = true;
			}

			$pending = $next;
			if (!$progress) {
				break;
			}
		}

		// 孤儿标签（父 id 不存在 / 循环引用）：落根级，保证标签本身不丢
		foreach ($pending as $tag) {
			$map[(int)$tag['id']] = $this->ensureTag($checkStmt, $insertStmt, $tag, 0, $created, $reused);
		}

		return ['map' => $map, 'new' => $created, 'same' => $reused];
	}

	/**
	 * 确保标签存在：已存在则复用，否则插入，返回新 id
	 */
	private function ensureTag(
		PDOStatement $checkStmt,
		PDOStatement $insertStmt,
		array $tag,
		int $parent,
		int &$created,
		int &$reused
	): int {
		$checkStmt->execute([
			':title' => (string)$tag['title'],
			':parent' => $parent,
		]);
		$existing = $checkStmt->fetch(PDO::FETCH_ASSOC);

		if ($existing) {
			$reused++;
			return (int)$existing['id'];
		}

		// module 显式写 'bookmarks'：不依赖列默认值，避免将来默认值变化把书签标签
		// 落进别的模块；created_at / updated_at 保留备份原值，排序与时间线不乱
		$insertStmt->execute([
			':title' => (string)$tag['title'],
			':description' => (string)($tag['description'] ?? ''),
			':color' => (string)($tag['color'] ?? 'gray'),
			':parent' => $parent,
			':pinned' => !empty($tag['pinned']) ? 1 : 0,
			':module' => 'bookmarks',
			':created_at' => $tag['created_at'] ?? date('Y-m-d H:i:s'),
			':updated_at' => $tag['updated_at'] ?? null,
		]);
		$created++;

		return (int)$this->pdo->lastInsertId();
	}

	/**
	 * 写入书签条目并建立标签关系
	 *
	 * merge：URL（归一后）已存在 → same 跳过；overwrite：此时表已清空，全部按新增写。
	 * 单条写入失败只标记该条 failed 并继续，其余条目照常提交，保证「逐条结果」可用
	 * （书签是本地写库，失败通常来自个别脏数据，不应让整批回滚）。
	 *
	 * @param array<int,int> $tagIdMap 旧标签 id → 新标签 id
	 * @return array{new:int, same:int, skipped:int, failed:int, items:array<int,array>}
	 */
	private function insertItems(array $items, array $tagIdMap, string $mode): array
	{
		$itemStmt = $this->pdo->prepare(
			'INSERT INTO items (title, url, description, comments, created_at, updated_at)
			 VALUES (:title, :url, :description, :comments, :created_at, :updated_at)'
		);
		$itemsTagsStmt = $this->pdo->prepare(
			'INSERT OR IGNORE INTO items_tags (item_id, tag_id) VALUES (:item_id, :tag_id)'
		);

		$existing = $mode === self::MODE_MERGE ? $this->existingUrlSet() : [];

		$counts = ['new' => 0, 'same' => 0, 'skipped' => 0, 'failed' => 0];
		$results = [];

		foreach ($items as $item) {
			$url = (string)$item['url'];
			$normalized = $this->normalizeUrl($url);

			if ($mode === self::MODE_MERGE && isset($existing[$normalized])) {
				$counts['same']++;
				$results[] = [
					'name' => $url,
					'status' => 'same',
					'message' => 'URL 已存在，已跳过',
				];
				continue;
			}

			try {
				$itemStmt->execute([
					':title' => (string)$item['title'],
					':url' => $normalized,
					':description' => (string)($item['description'] ?? ''),
					':comments' => (string)($item['comments'] ?? ''),
					':created_at' => $item['created_at'] ?? date('Y-m-d H:i:s'),
					':updated_at' => $item['updated_at'] ?? null,
				]);
				$itemId = (int)$this->pdo->lastInsertId();

				foreach (($item['tag_ids'] ?? []) as $oldTagId) {
					$newTagId = $tagIdMap[(int)$oldTagId] ?? null;
					if ($newTagId === null) {
						// 旧标签 id 在文件里找不到映射（被删的标签 / 脏引用），跳过该关系
						continue;
					}
					$itemsTagsStmt->execute([
						':item_id' => $itemId,
						':tag_id' => $newTagId,
					]);
				}

				$existing[$normalized] = true;
				$counts['new']++;
				$results[] = ['name' => $url, 'status' => 'new'];
			} catch (Throwable $e) {
				$counts['failed']++;
				$results[] = [
					'name' => $url,
					'status' => 'failed',
					'message' => '写入失败',
				];
			}
		}

		return [
			'new' => $counts['new'],
			'same' => $counts['same'],
			'skipped' => $counts['skipped'],
			'failed' => $counts['failed'],
			'items' => $results,
		];
	}

	/**
	 * 现有书签 URL 集合（归一后编码作为键）
	 *
	 * @return array<string,bool>
	 */
	private function existingUrlSet(): array
	{
		$urls = [];
		$stmt = $this->pdo->query('SELECT url FROM items');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$urls[$this->normalizeUrl((string)$row['url'])] = true;
		}
		return $urls;
	}

	/**
	 * URL 归一（与旧导入 / Repository::getItems 一致）
	 *
	 * items.url 落库时是 urlencode 后的形态，导出时 urldecode 还原；恢复写入前
	 * 重新 urlencode，判重时两侧都经同一函数归一，避免同一条地址因编码差异
	 * （空格 vs %20、中文 vs %E4%B8%AD）被当成两条。
	 */
	private function normalizeUrl(string $url): string
	{
		return urlencode(urldecode($url));
	}
}
