<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AccountPayload;
use Utils\VaultMetaPayload;
use function Framework\success;

class AccountsGetController implements ControllerInterface
{
	/**
	 * 前端 sorts key 的别名 → Repository 白名单列键（PRD §8.2 只允许这几个排序字段）
	 *
	 * Repository::getAccounts() 里还有一层白名单，未知值回落「更新时间倒序」，
	 * 这里只负责把前端常见的连字符写法（updated-desc / password-updated）翻译成列名。
	 */
	private const SORT_ALIASES = [
		'updated' => 'updated_at',
		'created' => 'created_at',
		'password-updated' => 'password_updated_at',
	];

	/**
	 * GET /api/accounts
	 *
	 * 列表只返回元数据 + 密文（PRD §7.4）：服务端没有 DEK，返回明文在技术上也不可能；
	 * 前端拿到密文后按需在浏览器内解密，解密结果只留在前端内存里。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 账号接口一律 no-store（PRD §7.5）：响应里有密文，不能被浏览器 / 代理缓存
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);
		AccountPayload::assertVaultInitialized($repository);

		[$page, $per_page, $limit, $offset] = $this->parsePagination($input);
		[$sort, $order] = $this->parseSort($input);

		$result = $repository->getAccounts([
			'search' => (string)($input['search'] ?? ''),
			'platform' => (string)($input['platform'] ?? ''),
			// 分组筛选按 id：`group` 与 `group_id` 都接受，非数字视为不筛选
			'group_id' => (int)($input['group'] ?? $input['group_id'] ?? 0),
			'sort' => $sort,
			'order' => $order,
			'limit' => $limit,
			'offset' => $offset,
		]);

		$group_names = $this->groupNames($repository);

		$accounts = array_map(
			fn(array $row): array => AccountPayload::formatAccount($row, $group_names[(int)($row['group_id'] ?? 0)] ?? null),
			$result['accounts']
		);

		$total = (int)$result['total'];

		return success('获取账号列表成功', [
			'accounts' => $accounts,
			// 键名兼容：账号库沿用 skills 的 accounts，个别调用方按 items 读取，两个键指向同一份数据
			'items' => $accounts,
			'total' => $total,
			'page' => $page,
			// 不传分页参数时返回全量（与 Skill 列表一致），此时 perPage 等于总数
			'perPage' => $per_page > 0 ? $per_page : $total,
		]);
	}

	/**
	 * 分页参数：优先 page + per-page（与前端 URL 状态一致），其次 limit / offset，
	 * 都不传就返回全量交给前端分页（dev-spec API 约定）。
	 *
	 * @return array{0:int,1:int,2:int,3:int} [page, perPage, limit, offset]
	 */
	private function parsePagination(array $input): array
	{
		$per_page = (int)($input['per-page'] ?? $input['per_page'] ?? 0);

		if ($per_page > 0) {
			$page = max(1, (int)($input['page'] ?? 1));

			return [$page, $per_page, $per_page, ($page - 1) * $per_page];
		}

		$limit = (int)($input['limit'] ?? 0);

		if ($limit > 0) {
			$offset = max(0, (int)($input['offset'] ?? 0));

			return [intdiv($offset, $limit) + 1, $limit, $limit, $offset];
		}

		$page = max(1, (int)($input['page'] ?? 1));

		return [$page, 0, 0, 0];
	}

	/**
	 * 排序参数：接受 `sort=updated_at&order=desc`，也接受 `sort=updated-desc` 这种
	 * 「字段-方向」合一的前端写法；显式 order 优先于 sort 里的方向。
	 *
	 * @return array{0:string,1:string}
	 */
	private function parseSort(array $input): array
	{
		$sort = trim((string)($input['sort'] ?? ''));
		$order = trim((string)($input['order'] ?? ''));

		if (preg_match('/^(.+)-(asc|desc)$/i', $sort, $matches)) {
			$sort = $matches[1];
			$order = '' === $order ? strtolower($matches[2]) : $order;
		}

		return [self::SORT_ALIASES[$sort] ?? $sort, $order];
	}

	/**
	 * 分组 id → 名称映射
	 *
	 * 分组是账号库内部字典，与书签 / Skill 的 tags 无关（PRD §5.1.1 模块隔离）。
	 *
	 * @return array<int,string>
	 */
	private function groupNames(Repository $repository): array
	{
		$names = [];

		foreach ($repository->getAccountGroups() as $group) {
			$names[(int)$group['id']] = (string)$group['name'];
		}

		return $names;
	}
}
