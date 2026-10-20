<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;

class ExportDataController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$tags = $repository->getTags();
		$items = $repository->getItems();

		$exportTags = [];
		foreach ($tags as $tag) {
			$exportTags[] = [
				'id' => (int)$tag['id'],
				'title' => $tag['title'],
				'description' => $tag['description'],
				'color' => $tag['color'],
				'parent' => (int)$tag['parent'],
				'pinned' => (bool)(int)$tag['pinned'],
				'created_at' => $tag['created_at'],
				'updated_at' => $tag['updated_at'],
			];
		}

		$exportItems = [];
		foreach ($items as $item) {
			$exportItems[] = [
				'id' => (int)$item['id'],
				'title' => $item['title'],
				'url' => $item['url'],
				'description' => $item['description'],
				'comments' => $item['comments'],
				'tag_ids' => array_map('intval', $item['tags']),
				'created_at' => $item['created_at'],
				'updated_at' => $item['updated_at'],
			];
		}

		return success('数据导出成功', [
			'version' => 1,
			'exported_at' => date('c'),
			'tags' => $exportTags,
			'items' => $exportItems,
		]);
	}
}
