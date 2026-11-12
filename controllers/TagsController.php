<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;
use function Utils\normalizeTagModule;

class TagsController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		// 标签按模块隔离（PRD O-9）：GET /api/tags?module=bookmarks|skills。
		// 接口语义变化说明：旧版返回全量标签；现在默认（缺省或非法值）按 bookmarks
		// 过滤，旧前端不带该参数时看到的行为与模块隔离前一致，不会拿到 skills 标签
		$module = normalizeTagModule($input['module'] ?? null);

		$tags = $repository->getTags($module);

		return data($tags);
	}
}
