<?php

namespace Controllers;

use Exception;
use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Utils\BookmarkRestorer;
use function Framework\success;

/**
 * POST /api/import/data（旧书签导入端点，dev-spec §4 / §6.5 兼容口径）
 *
 * 前端现有导入流程保持不变：上传字段仍是 backup-json，响应仍是 success(message)。
 * 内部改为转调 BookmarkRestorer，与 /api/backup/bookmarks/restore 共用同一份
 * 「解析 → 校验 → 标签重映射 → 写库」逻辑，避免两套导入实现漂移。
 *
 * 兼容差异（只作用于本端点）：历史导出文件不带 module 字段，解析时补默认值
 * 'bookmarks'；该适配层不下沉到 BookmarkRestorer 的默认行为——新恢复端点
 * /api/backup/bookmarks/restore 缺 module 仍严格 400（dev-spec §6.5 唯一例外）。
 *
 * 行为沿用旧版：固定合并语义（按 URL 跳过已存在条目），没有覆盖模式。
 */
class ImportDataController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		try {
			if (!isset($_FILES['backup-json']) || $_FILES['backup-json']['error'] !== UPLOAD_ERR_OK) {
				throw new ValidationException('未上传文件或上传失败', 400);
			}

			$uploaded_file = $_FILES['backup-json'];
			$file_ext = strtolower(pathinfo($uploaded_file['name'], PATHINFO_EXTENSION));
			if ($file_ext !== 'json') {
				throw new ValidationException('上传文件不是 JSON 格式', 400);
			}

			$file_content = file_get_contents($uploaded_file['tmp_name']);
			if ($file_content === false) {
				throw new ValidationException('无法读取上传的文件', 400);
			}

			$restorer = new BookmarkRestorer(ServiceContainer::get(\PDO::class));

			// true = 允许缺 module 并补默认 bookmarks（仅旧端点）
			$payload = $restorer->parse($file_content, true);
			$result = $restorer->restore($payload, BookmarkRestorer::MODE_MERGE, false);

			$message = "成功导入 {$result['tags']['new']} 个标签、{$result['summary']['new']} 个书签";
			if ($result['tags']['same'] > 0) {
				$message .= "，{$result['tags']['same']} 个标签因重复已跳过";
			}

			return success($message);
		} catch (Exception $e) {
			throw new Exception('导入数据失败: ' . $e->getMessage(), $e->getCode());
		}
	}
}
