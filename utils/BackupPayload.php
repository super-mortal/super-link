<?php

namespace Utils;

/**
 * 备份文件格式工具（refinements.md §4 / dev-spec §6）。
 *
 * 为什么集中在这里：备份是「一类文件格式」而不是「一个端点」——bookmarks / skills /
 * servers 三个模块共用同一套信封（module / version / exported_at）与文件名规则
 * （super-link-<module>-YYYYMMDD.json），字段映射（标签 / 条目）也被新旧端点共用。
 * 各控制器自己拼会立刻出现版本号、日期格式、字段大小写三处以上漂移，恢复端按
 * 文件格式硬校验时才会以「备份文件格式不正确」的形式爆出来。
 *
 * 兼容边界（dev-spec §4 / §6.5）：旧端点 `GET /api/export/data` 的响应结构一个
 * 字段都不能改（仍为 { success, message, data: { version, exported_at, tags, items } }，
 * items 带 id、整体不带 module），所以这里同时提供：
 *   - build()   → 新备份文件信封（含 module），供 /api/backup/* 使用；
 *   - payload() → 仅 version + exported_at，供旧端点包进 success() 的 data，
 *                 版本号与导出时间仍与备份文件同源，不另立一份实现。
 */
class BackupPayload
{
	/**
	 * 当前备份格式版本（dev-spec §6.1，三个模块共用）
	 *
	 * 以后做不兼容的结构变化时递增，恢复端按此拒绝未知高版本文件。
	 */
	public const VERSION = 1;

	/**
	 * 组装新备份文件信封：{ module, version, exported_at, ...$data }
	 *
	 * @param string $module bookmarks|skills|servers（调用方自行保证取值合法）
	 * @param array  $data   模块数据（tags / items / skills / servers 等）
	 */
	public static function build(string $module, array $data): array
	{
		return [
			'module' => $module,
			'version' => self::VERSION,
			'exported_at' => date('c'),
		] + $data;
	}

	/**
	 * 旧端点兼容信封：只含 version / exported_at，**不含 module**
	 *
	 * `GET /api/export/data` 的历史响应里没有 module（历史备份文件同样没有），
	 * 加上去等于改接口；前端也不读该字段。版本号 / 导出时间与 build() 同源。
	 */
	public static function payload(array $data): array
	{
		return [
			'version' => self::VERSION,
			'exported_at' => date('c'),
		] + $data;
	}

	/**
	 * 预检响应扁平化：把 summary 里的分类计数提升到顶层
	 *
	 * refinements.md §4.5 约定 dry_run 直接返回 `{ new, same, skipped }` 与逐条预览，
	 * 而执行阶段保留 `{ items, summary }`（同一份结果结构供 UI 复用）。三个恢复器
	 * 内部统一产出 summary，这里只在预检响应出口做一次形态转换，避免三处各写一遍。
	 *
	 * 不修改原数组：返回新数组，summary 被移除，其余键（items / tags / note /
	 * removed / mode / dry_run）原样保留。
	 */
	public static function flattenPreview(array $result): array
	{
		if (!isset($result['summary']) || !is_array($result['summary'])) {
			return $result;
		}

		$flattened = $result;
		unset($flattened['summary']);
		foreach ($result['summary'] as $key => $value) {
			$flattened[$key] = $value;
		}

		return $flattened;
	}

	/**
	 * 备份文件名：super-link-<module>-YYYYMMDD.json（dev-spec §6.1）
	 *
	 * 只用于 Content-Disposition 下载头；同一天多次导出会得到同名文件，
	 * 由浏览器自行去重（加序号），服务端不做唯一化。
	 */
	public static function fileName(string $module): string
	{
		return "super-link-{$module}-" . date('Ymd') . '.json';
	}

	/**
	 * 备份响应禁止缓存（dev-spec §4）
	 *
	 * DataResponse 本身已输出 no-cache / no-store / must-revalidate，这里再显式
	 * 声明一次：备份文件是数据快照（服务器备份含 Token 哈希与盐），以后端点换成
	 * 其它响应类型时也不会丢掉 no-store（同 VaultMetaPayload::noStore()）。
	 */
	public static function noStore(): void
	{
		header('Cache-Control: no-store');
	}

	/**
	 * 标签字段映射（旧导出与书签备份共用）
	 *
	 * 出参键序与 dev-spec §6.2 一致；id / parent 转 int、pinned 转 bool
	 * （SQLite 存的是 0/1，直接吐给 JSON 会变成数字，恢复端按布尔解析会误判）。
	 */
	public static function mapTags(array $tags): array
	{
		$export = [];
		foreach ($tags as $tag) {
			$export[] = [
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
		return $export;
	}

	/**
	 * 条目字段映射（旧导出与书签备份共用）
	 *
	 * $include_id 是旧端点兼容开关：
	 *   - 旧导出 `GET /api/export/data` 必须保留 item id（前端与历史文件均按它引用）→ true；
	 *   - 新备份文件 dev-spec §6.2 的 items 不含 id（判重键是 URL）→ false（默认）。
	 * 其余字段两边完全一致，所以只用一个映射函数，用开关区分而不是复制第二份。
	 */
	public static function mapItems(array $items, bool $include_id = false): array
	{
		$export = [];
		foreach ($items as $item) {
			$row = [];
			if ($include_id) {
				$row['id'] = (int)$item['id'];
			}
			$row['title'] = $item['title'];
			$row['url'] = $item['url'];
			$row['description'] = $item['description'];
			$row['comments'] = $item['comments'];
			// tag_ids 一律转 int：Repository::getItemsTags() 已是 int，这里兜底旧库的字符串形态
			$row['tag_ids'] = array_map('intval', $item['tags']);
			$row['created_at'] = $item['created_at'];
			$row['updated_at'] = $item['updated_at'];
			$export[] = $row;
		}
		return $export;
	}
}
