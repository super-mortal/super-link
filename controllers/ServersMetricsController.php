<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use function Framework\success;

class ServersMetricsController implements ControllerInterface
{
	/**
	 * range 白名单（PRD §6：1h|6h|24h|30d）
	 *
	 * 前三档返回明细序列，30d 档由 Repository 在 SQL 层按小时聚合
	 * （决策 D4：不建聚合表、不保留聚合数据，PRD §5.4）。
	 */
	private const RANGES = ['1h', '6h', '24h', '30d'];

	/** 走小时聚合的档位：唯一值，单独命名避免控制器里散落字面量 */
	private const HOURLY_RANGE = '30d';

	/**
	 * GET /api/servers/metrics?server-id=&range=
	 *
	 * 历史指标序列（PRD §5.5 图表区 / §6）。明细档按 received_at 升序
	 * （Repository::getServerMetrics 保证）；30d 档的小时聚合口径
	 * （AVG / MAX 分工）见 Repository::getServerMetricsHourly 注释。
	 * 两种来源的字段名与格式一致，前端图表代码无需区分。
	 *
	 * range 缺失或白名单外一律 400：静默回落默认档会让图表展示错范围的
	 * 数据，比报错更难排查。服务器不存在（含 id 非法）为 404，语义与
	 * 列表 / 详情等用户态端点一致。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$id = ServerPayload::parseId($input['server-id'] ?? $input['server_id'] ?? $input['id'] ?? null);

		if (!$repository->getServerById($id)) {
			throw new NotFoundException('服务器不存在');
		}

		$range = strtolower(trim((string)($input['range'] ?? '')));

		if (!in_array($range, self::RANGES, true)) {
			throw new ValidationException('range 参数不正确，仅支持 ' . implode(' / ', self::RANGES), 400);
		}

		if (self::HOURLY_RANGE === $range) {
			$rows = $repository->getServerMetricsHourly($id, $range);
		} else {
			// 明细档：range 字面量由 Repository 换算成 since（SERVER_METRIC_RANGES）
			$rows = $repository->getServerMetrics($id, ['range' => $range]);
		}

		return success('获取服务器指标成功', [
			'server_id' => $id,
			'range' => $range,
			// 聚合桶的标签列同样叫 received_at（小时桶形如 '2026-11-16 14:00:00'），
			// 与明细点统一走 formatPoint；横轴粒度由前端按 range 自行推断
			'points' => array_map([$this, 'formatPoint'], $rows),
			// 点数：空结果（等待连接 / 时段无数据）时为 0，前端展示空态
			'total' => count($rows),
		]);
	}

	/**
	 * 单点指标格式化：明细行与小时聚合桶共用
	 *
	 * 数值一律转标量（PDO 对 SQLite REAL / AVG 结果可能返回字符串）；
	 * 单位保持库内原始单位（字节 / 字节每秒 / 百分比 / 秒），换算与阈值
	 * 配色在前端做（与列表卡片 latest 的口径一致）。
	 */
	private function formatPoint(array $row): array
	{
		return [
			'received_at' => $row['received_at'] ?? null,
			'cpu' => (float)($row['cpu'] ?? 0),
			'mem_used' => (int)($row['mem_used'] ?? 0),
			'mem_total' => (int)($row['mem_total'] ?? 0),
			'mem_cached' => (int)($row['mem_cached'] ?? 0),
			'swap_used' => (int)($row['swap_used'] ?? 0),
			'swap_total' => (int)($row['swap_total'] ?? 0),
			'load1' => (float)($row['load1'] ?? 0),
			'load5' => (float)($row['load5'] ?? 0),
			'load15' => (float)($row['load15'] ?? 0),
			'net_rx' => (int)($row['net_rx'] ?? 0),
			'net_tx' => (int)($row['net_tx'] ?? 0),
			'uptime' => (int)($row['uptime'] ?? 0),
		];
	}
}
