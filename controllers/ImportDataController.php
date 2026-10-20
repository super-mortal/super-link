<?php

namespace Controllers;

use Exception;
use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use function Framework\success;

class ImportDataController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		try {
			if (!isset($_FILES['backup-json']) || $_FILES['backup-json']['error'] !== UPLOAD_ERR_OK) {
				throw new ValidationException('未上传文件或上传失败');
			}

			$uploaded_file = $_FILES['backup-json'];
			$file_ext = strtolower(pathinfo($uploaded_file['name'], PATHINFO_EXTENSION));
			if ($file_ext !== 'json') {
				throw new ValidationException('上传文件不是 JSON 格式');
			}

			$file_content = file_get_contents($uploaded_file['tmp_name']);
			if ($file_content === false) {
				throw new ValidationException('无法读取上传的文件');
			}

			$data = json_decode($file_content, true);
			if ($data === null) {
				throw new ValidationException('JSON 解析失败');
			}

			if (!isset($data['version'], $data['tags'], $data['items'])) {
				throw new ValidationException('无效的备份文件格式');
			}

			$pdo = ServiceContainer::get(\PDO::class);

			$tagIdMap = [];
			$importedTags = 0;
			$importedItems = 0;
			$skippedTags = 0;

			$pdo->beginTransaction();

			try {
				$insertStmt = $pdo->prepare(
					'INSERT INTO tags (title, description, color, parent, pinned, created_at, updated_at)
					 VALUES (:title, :description, :color, :parent, :pinned, :created_at, :updated_at)'
				);

				$checkStmt = $pdo->prepare(
					'SELECT id FROM tags WHERE title = :title AND parent = :parent'
				);

				// 多轮处理：按 parent 依赖顺序插入标签
				$remaining = $data['tags'];
				$maxIterations = count($data['tags']);
				$iteration = 0;

				while (!empty($remaining) && $iteration < $maxIterations) {
					$iteration++;
					$unprocessed = [];

					foreach ($remaining as $tag) {
						$oldParentId = (int)($tag['parent'] ?? 0);
						$newParentId = $tagIdMap[$oldParentId] ?? null;

						if ($oldParentId === 0 || $newParentId !== null) {
							// parent 已解析（root 或已在映射中），可以插入
							$parentToUse = $newParentId ?? 0;
							$checkStmt->execute([
								':title' => $tag['title'],
								':parent' => $parentToUse,
							]);
							$existing = $checkStmt->fetch(\PDO::FETCH_ASSOC);

							if ($existing) {
								// 重复，映射到已有标签
								$tagIdMap[(int)$tag['id']] = (int)$existing['id'];
								$skippedTags++;
							} else {
								// 插入，parent 直接用映射后的新 ID
								$insertStmt->execute([
									':title' => $tag['title'],
									':description' => $tag['description'] ?? '',
									':color' => $tag['color'] ?? 'gray',
									':parent' => $parentToUse,
									':pinned' => !empty($tag['pinned']) ? 1 : 0,
									':created_at' => $tag['created_at'] ?? date('Y-m-d H:i:s'),
									':updated_at' => $tag['updated_at'] ?? null,
								]);
								$tagIdMap[(int)$tag['id']] = (int)$pdo->lastInsertId();
								$importedTags++;
							}
						} else {
							// parent 尚未映射（父标签还未插入），留到下一轮
							$unprocessed[] = $tag;
						}
					}

					$remaining = $unprocessed;
				}

				// 处理剩余标签（孤立 parent 引用，parent 设为 0）
				foreach ($remaining as $tag) {
					$checkStmt->execute([
						':title' => $tag['title'],
						':parent' => 0,
					]);
					$existing = $checkStmt->fetch(\PDO::FETCH_ASSOC);

					if ($existing) {
						$tagIdMap[(int)$tag['id']] = (int)$existing['id'];
						$skippedTags++;
					} else {
						$insertStmt->execute([
							':title' => $tag['title'],
							':description' => $tag['description'] ?? '',
							':color' => $tag['color'] ?? 'gray',
							':parent' => 0,
							':pinned' => !empty($tag['pinned']) ? 1 : 0,
							':created_at' => $tag['created_at'] ?? date('Y-m-d H:i:s'),
							':updated_at' => $tag['updated_at'] ?? null,
						]);
						$tagIdMap[(int)$tag['id']] = (int)$pdo->lastInsertId();
						$importedTags++;
					}
				}

			// 插入书签
			$itemStmt = $pdo->prepare(
				'INSERT INTO items (title, description, url, comments, created_at, updated_at)
				 VALUES (:title, :description, :url, :comments, :created_at, :updated_at)'
			);

				$itemsTagsStmt = $pdo->prepare(
					'INSERT OR IGNORE INTO items_tags (item_id, tag_id) VALUES (:item_id, :tag_id)'
				);

				foreach ($data['items'] as $item) {
					$itemStmt->execute([
						':title' => $item['title'],
						':description' => $item['description'] ?? '',
						':url' => urlencode(urldecode($item['url'])),
						':comments' => $item['comments'] ?? '',
						':created_at' => $item['created_at'] ?? date('Y-m-d H:i:s'),
						':updated_at' => $item['updated_at'] ?? null,
					]);

					$newItemId = $pdo->lastInsertId();
					if ($newItemId) {
						$importedItems++;

						if (!empty($item['tag_ids'])) {
							foreach ($item['tag_ids'] as $oldTagId) {
								$newTagId = $tagIdMap[(int)$oldTagId] ?? null;
								if ($newTagId) {
									$itemsTagsStmt->execute([
										':item_id' => $newItemId,
										':tag_id' => $newTagId,
									]);
								}
							}
						}
					}
				}

				$pdo->commit();
			} catch (Exception $e) {
				$pdo->rollBack();
				throw $e;
			}

			$message = "成功导入 {$importedTags} 个标签、{$importedItems} 个书签";
			if ($skippedTags > 0) {
				$message .= "，{$skippedTags} 个标签因重复已跳过";
			}

			return success($message);
		} catch (Exception $e) {
			throw new Exception('导入数据失败: ' . $e->getMessage(), $e->getCode());
		}
	}
}
