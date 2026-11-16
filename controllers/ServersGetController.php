<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use function Framework\success;

class ServersGetController implements ControllerInterface
{
	/**
	 * 列表排序支持的键（PRD §5.5：状态 / 名称 / CPU / 内存，另带时间列）
	 *
	 * 白名单外的值回落 id：排序在控制器内做，不存在 SQL 拼接面，
	 * 但白名单仍要收束未知键，避免前端拼错 sort 时拿到难以理解的顺序。
	 */
	private const SORT_KEYS = [
		'id',
		'name',
		'group',
		'status',
		'cpu',
		'mem',
		'last_report_at',
		'created_at',
		'updated_at',
	];

	/**
	 * GET /api/servers
	 *
	 * 列表 + 每台最新快照摘要 + 连接状态 + 侧栏分组计数（PRD §5.1 / §5.5 / §6）。
	 * 用户态接口：会话认证（未登录 401），写操作外的 GET 天然跳过 CSRF 中间件。
	 * 响应不含 token_hash / token_salt（由 ServerPayload::formatServer 白名单保证）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$search = trim((string)($input['search'] ?? ''));
		// 分组筛选：白名单外的值直接 400（拼错筛选条件时静默返回全量比报错更容易看错数据）
		$group = ServerPayload::parseGroup($input['group'] ?? $input['group_name'] ?? null);
		[$sort, $order] = $this->parseSort($input);

		// 一次取回搜索命中的全量结果：个人级服务器数量（PRD §5.5），分组计数、
		// 分组筛选与「按指标 / 状态排序」都在这份数据上完成——后两者依赖明细表与
		// 连接注册表，ORDER BY 排不了，只能取回后在内存排；分页由前端做（与账号库一致）
		$rows = $repository->getServers(['search' => $search]);

		// 侧栏分组计数（PRD §5.5）：按搜索命中全集统计，不受当前分组筛选影响——
		// 点了「公司」之后其他分组的计数仍在，用户才知道筛选之外还有什么
		$group_counts = array_fill_keys(ServerPayload::GROUPS, 0);
		foreach ($rows as $row) {
			$group_name = (string)($row['group_name'] ?? '');
			if (isset($group_counts[$group_name])) {
				$group_counts[$group_name]++;
			}
		}

		if (null !== $group) {
			$rows = array_values(array_filter(
				$rows,
				fn(array $row): bool => (string)($row['group_name'] ?? '') === $group
			));
		}

		$servers = array_map(
			fn(array $row): array => $this->formatServerWithSummary($repository, $row),
			$rows
		);

		$servers = $this->sortServers($servers, $sort, $order);

		return success('获取服务器列表成功', [
			'servers' => $servers,
			'total' => count($servers),
			// 四项分组恒定出现（为 0 也返回），前端侧栏不必猜有哪些分组
			'groups' => $group_counts,
		]);
	}

	/**
	 * 服务器行 + 最新快照摘要 + 连接状态（PRD §5.1 卡片结构）
	 *
	 * 每台三次明细查询（最新指标 / 最新一批磁盘 / 最新一批容器）+ 一次连接注册表
	 * 查询：个人级 < 20 台的量下属可接受；卡片只取「最新」，不查历史序列。
	 * 指标值一律用库里的原始单位（字节 / 秒 / 百分比），单位换算与阈值配色在前端做。
	 */
	private function formatServerWithSummary(Repository $repository, array $row): array
	{
		$server_id = (int)$row['id'];

		$metrics = $repository->getLatestServerMetrics($server_id);
		$disks = $repository->getLatestServerDisks($server_id);
		$docker_count = count($repository->getLatestServerDocker($server_id));
		$connection_active = null !== $repository->getActiveServerConnectionId($server_id);

		$server = ServerPayload::formatServer($row);
		$server['status'] = ServerPayload::resolveStatus(
			$server['paused'],
			$connection_active,
			is_string($server['last_report_at']) ? $server['last_report_at'] : null
		);
		// null = 从未回传（等待连接）：前端据此不渲染指标行（PRD §5.1）
		$server['latest'] = false === $metrics ? null : [
			'cpu' => (float)$metrics['cpu'],
			'mem_used' => (int)$metrics['mem_used'],
			'mem_total' => (int)$metrics['mem_total'],
			'mem_cached' => (int)$metrics['mem_cached'],
			'swap_used' => (int)$metrics['swap_used'],
			'swap_total' => (int)$metrics['swap_total'],
			'load1' => (float)$metrics['load1'],
			'load5' => (float)$metrics['load5'],
			'load15' => (float)$metrics['load15'],
			'net_rx' => (int)$metrics['net_rx'],
			'net_tx' => (int)$metrics['net_tx'],
			'uptime' => (int)$metrics['uptime'],
			'received_at' => $metrics['received_at'],
		];
		// 最新一批磁盘（一次快照每挂载点一行）：前端取用量最大挂载点做 meter，
		// 悬停展示全部分区（PRD §5.1）
		$server['disks'] = array_map(fn(array $disk): array => [
			'mount' => (string)$disk['mount'],
			'used' => (int)$disk['used'],
			'total' => (int)$disk['total'],
		], $disks);
		// 卡片只展示容器数；容器明细（名称 / 状态 / CPU / 内存 / 网络）在详情页（PRD §5.5）
		$server['docker_count'] = $docker_count;

		return $server;
	}

	/**
	 * 排序参数：接受 sort + order 分离，也接受 sort=cpu-desc 这种「字段-方向」合一写法
	 * （mockups 的 SERVER_SORTS 即 name-asc / cpu-desc / mem-desc 形态，PRD §5.5）。
	 *
	 * 与账号库不同，状态 / CPU / 内存排序只能在控制器内完成：ORDER BY 排不了
	 * 「最新快照的 CPU」与「连接状态」——这两项依赖明细表与连接注册表。
	 *
	 * @return array{0:string,1:string} [sort, order]，sort 必为 SORT_KEYS 之一
	 */
	private function parseSort(array $input): array
	{
		$sort = strtolower(trim((string)($input['sort'] ?? '')));
		$order = strtolower(trim((string)($input['order'] ?? '')));

		if (preg_match('/^(.+)-(asc|desc)$/', $sort, $matches)) {
			$sort = $matches[1];
			$order = '' === $order ? $matches[2] : $order;
		}

		if (!in_array($sort, self::SORT_KEYS, true)) {
			$sort = 'id';
		}

		// 缺省方向：状态按「在线优先」升序，其余倒序（与 Repository 默认 id 倒序、
		// 新服务器在前的惯例一致）
		if (!in_array($order, ['asc', 'desc'], true)) {
			$order = 'status' === $sort ? 'asc' : 'desc';
		}

		return [$sort, $order];
	}

	/**
	 * 内存排序（PRD §5.5：状态 / 名称 / CPU / 内存）
	 *
	 * 无快照数据的服务器（等待连接）在 CPU / 内存排序里按 -1 参与比较，排在有数据的之后。
	 * 同键时按 id 倒序兜底，保证列表刷新时顺序稳定、可复现（与 Repository
	 * 「追加 id 作为次级排序」同一意图）。
	 */
	private function sortServers(array $servers, string $sort, string $order): array
	{
		$direction = 'asc' === $order ? 1 : -1;

		usort($servers, function (array $left, array $right) use ($sort, $direction): int {
			$result = match ($sort) {
				'name' => strcasecmp($left['name'], $right['name']),
				'group' => strcasecmp($left['group'], $right['group']),
				'status' => self::statusRank($left['status']) <=> self::statusRank($right['status']),
				'cpu' => ($left['latest']['cpu'] ?? -1.0) <=> ($right['latest']['cpu'] ?? -1.0),
				'mem' => ($left['latest']['mem_used'] ?? -1) <=> ($right['latest']['mem_used'] ?? -1),
				'last_report_at' => strcmp((string)$left['last_report_at'], (string)$right['last_report_at']),
				'created_at' => strcmp((string)$left['created_at'], (string)$right['created_at']),
				'updated_at' => strcmp((string)$left['updated_at'], (string)$right['updated_at']),
				default => $left['id'] <=> $right['id'],
			};

			if (0 === $result) {
				return $right['id'] <=> $left['id'];
			}

			return $direction * $result;
		});

		return $servers;
	}

	/**
	 * 状态排序权重：「在线优先」（mockups SERVER_SORTS，PRD §5.5）——
	 * 在线排最前，其次离线（有异常需关注），再等待连接，最后已暂停
	 */
	private static function statusRank(string $status): int
	{
		return match ($status) {
			ServerPayload::STATUS_ONLINE => 0,
			ServerPayload::STATUS_OFFLINE => 1,
			ServerPayload::STATUS_PENDING => 2,
			ServerPayload::STATUS_PAUSED => 3,
			default => 4,
		};
	}
}
