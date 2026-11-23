<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\BackupPayload;
use function Framework\data;

class BackupBookmarksGetController implements ControllerInterface
{
	/**
	 * GET /api/backup/bookmarks
	 *
	 * 书签模块 JSON 备份（refinements.md §4.2 / dev-spec §6.2）：
	 * { module: 'bookmarks', version, exported_at, tags: [...], items: [...] }
	 *
	 * 数据范围：只含 module='bookmarks' 的标签；items 是全部书签条目，
	 * 带 tag_ids（不含 id，判重键是 URL，归一规则与旧导入一致）。
	 *
	 * 响应形态：data() 直接返回备份对象——响应体本身就是备份文件内容，
	 * 前端 fetch 后存盘、直接访问端点存盘的字节一致；出错仍走框架统一
	 * { success: false, message, error }。
	 *
	 * 安全：备份文件等同数据快照（含用户全部书签与标签），响应显式 no-store，
	 * 不允许浏览器 / 代理缓存；端点走默认会话认证（GET 天然跳过 CSRF），
	 * 不加入任何认证 / CSRF / migrate 跳过名单。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		BackupPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);

		// 只取书签模块标签：tags.module='skills' 属于 Skill 备份范围，
		// 混进书签备份会在恢复时于书签侧重建出无主标签
		$tags = $repository->getTags('bookmarks');
		$items = $repository->getItems();

		// 下载头：直接访问端点时浏览器存成 super-link-bookmarks-YYYYMMDD.json
		header('Content-Disposition: attachment; filename="' . BackupPayload::fileName('bookmarks') . '"');

		return data(BackupPayload::build('bookmarks', [
			'tags' => BackupPayload::mapTags($tags),
			'items' => BackupPayload::mapItems($items),
		]));
	}
}
