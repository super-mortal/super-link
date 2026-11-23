<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\BackupPayload;
use function Framework\success;

class ExportDataController implements ControllerInterface
{
	/**
	 * GET /api/export/data（旧端点，保留兼容）
	 *
	 * 响应结构一个字段都不改（dev-spec §4 / §6.5）：
	 * { success, message, data: { version, exported_at, tags, items } }
	 * 前端仍读 data.tags / data.items；items 保留 id，整体不带 module。
	 *
	 * 与书签备份共用 Utils\BackupPayload 的字段映射与版本 / 导出时间组装，
	 * 避免两处各拼一份后漂移；本端点只用 payload()（无 module）且
	 * mapItems 传 true 保留 id。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$tags = $repository->getTags();
		$items = $repository->getItems();

		return success('数据导出成功', BackupPayload::payload([
			'tags' => BackupPayload::mapTags($tags),
			'items' => BackupPayload::mapItems($items, true),
		]));
	}
}
