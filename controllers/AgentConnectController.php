<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerToken;
use function Framework\data;

/**
 * GET /api/agent/connect —— 长轮询接入（PRD docs/prd/server.md §5.2 / §5.6 / 决策 D11）
 *
 * agent（link-agent，Go 静态二进制 daemon）启动后主动外连本端点并保持，Hub 经该
 * 连接下发采集指令；PHP + Apache 约束下以长轮询实现该语义，不引入独立 WebSocket
 * 服务进程。本端点是 Hub → agent 的唯一下行信道，task7（report 回传）与 task19
 * （agent 侧连接管理）按下面的协议约定对齐：
 *
 * ── 请求 ────────────────────────────────────────────────────────────
 * GET，无查询串 / body；凭据只走请求头 X-Agent-Token: <token 明文>（每服务器
 * 唯一，添加 / 重置时完整展示一次，服务端只存哈希，PRD D6）。不依赖 cookie /
 * session：本端点已由 task5 加入 bootstrap 的 session 跳过与两个中间件的豁免
 * 名单，控制器内也不调用任何 session API。
 *
 * ── 响应（200，Content-Type: application/x-ndjson）────────────────────
 * 按行读取的 JSON 流，共三种行（agent 逐行读、空行跳过）：
 * 1. 采集指令 {"cmd":"collect"}：agent 立即采集全量快照并经
 *    POST /api/agent/report 回传（快照字段白名单由 task7 定义）。下发节奏
 *    由 Hub 控制：连接建立时若该服务器已满一个采集周期（last_report_at
 *    距今 ≥ 5 分钟，或从未回传）立即下发一次，之后每 5 分钟一次；未满则
 *    等到期再发（单次持有 50s < 周期 300s，一个连接内最多下发一条）。
 * 2. 保活空行：Hub 每秒写入一个空行并 flush，agent 跳过即可；空行同时让
 *    Hub 借「写输出」感知 agent 断开（mod_php 下不写输出感知不到）。
 * 3. 结束行 {"ok":true,"action":"reconnect"}：本次长轮询正常到期，agent
 *    立即重连（长轮询语义，非错误，无需退避）。被后续连接挤占时结束行为
 *    {"ok":true,"action":"reconnect","reason":"superseded"}：agent 按指数
 *    退避重连，避免新旧两个 agent 互相挤占的热循环。
 *
 * ── 非 200 ───────────────────────────────────────────────────────────
 * 401：Token 无效或服务器不存在——两者响应体逐字节一致，agent 无法也无需
 *      区分；停止重连并记录日志（task19）。
 * 403：服务器已暂停（paused=1）——agent 保持守护、按退避间隔重试即可，
 *      用户恢复后自然接入；暂停期间 Hub 不做离线判定（PRD §5.1）。
 *
 * ── 实现约束（PRD §5.2，均经现有代码核实）─────────────────────────────
 * - 单次持有上限 50s：生产镜像 Dockerfile.build 的 max_execution_time=60，
 *   顶格持有会被 PHP 掐断；50s 同时是对 Apache worker 占持与前置反代超时
 *   的保护（Hub 前置 nginx / Caddy 时需调大 proxy_read_timeout，task22 文档）。
 * - 循环内每秒级 flush() + connection_aborted() 自检，兑现「断开即离线
 *   （秒级）」（决策 D11）。
 * - 每 Token 单活跃连接：server_connections 注册表（task1），新连接挤占旧
 *   连接，旧连接下次自检发现被顶替即退出。
 */
class AgentConnectController implements ControllerInterface
{
	/**
	 * 单次长轮询持有上限（秒）
	 *
	 * PRD §5.2 要求 45–55s，取 50s：留 10s 余量给 max_execution_time=60
	 * （顶格持有会被 PHP 直接掐断，连接带着半截响应断掉，agent 侧只看得到
	 * 一次异常断开），也避免 Apache worker 被单连接占持过久。
	 */
	private const HOLD_SECONDS = 50;

	/** 采集周期（秒）：Hub 每 5 分钟经连接下发一次采集指令（PRD §5.2 / 决策 D4） */
	private const COLLECT_INTERVAL = 300;

	/**
	 * 连接注册行 TTL（秒）：略大于持有上限，保证连接存活期间自己的注册行
	 * 不会因过期而「假性失效」；真正的过期行由 cleanupServerConnections()
	 * 清理，作为「断开即离线」的兜底（task1）
	 */
	private const CONNECTION_TTL = 60;

	/** 401 消息：无效 Token 与不存在服务器共用同一常量，保证响应体逐字节一致（PRD §5.6） */
	private const UNAUTHORIZED_MESSAGE = 'Agent 认证失败';

	/**
	 * 拉平耗时用的虚拟校验材料（PRD §5.6）
	 *
	 * 「无效 Token」与「服务器不存在」必须走同一分支且耗时一致。本端点的
	 * 认证是「Token 对全部服务器逐条 verify」（盐每服务器随机，无法按哈希
	 * 检索），两种失败场景天然就是同一条代码路径；但库里一台服务器都没有
	 * 时一次真实哈希都不会发生，这里用一对固定值补一次完整的 SHA-256 +
	 * hash_equals，保证任何失败路径都实打实做过至少一次哈希运算。固定值
	 * 非机密，唯一目的是消耗与真实校验同等的 CPU。
	 */
	private const DUMMY_TOKEN = 'slk_dummy_token_for_timing_equalization';
	private const DUMMY_SALT = 'slk_dummy_salt_for_timing_equalization';
	private const DUMMY_HASH = '5f2b8a1c9e4d7f306a2b9c8d5e1f4a7b3c6d9e2f5a8b1c4d7e0f3a6b9c2d5e8f';

	/**
	 * GET /api/agent/connect
	 *
	 * 流程：Token 校验 → 暂停判定 → 注册连接（挤占旧连接）→ 长轮询主循环
	 * （每秒保活 / 断开自检 / 挤占自检 / 采集指令到期下发）→ 清理注册行 →
	 * 输出结束行。401 / 403 / 500 三个失败分支都在流式输出开始前返回，走
	 * 框架标准 DataResponse；进入循环后响应体改为按行流式输出，结束时返回
	 * 空 yield() 的响应（见方法末尾）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$token = trim((string)($_SERVER['HTTP_X_AGENT_TOKEN'] ?? ''));

		$server = $this->authenticate($repository, $token);
		if (null === $server) {
			return $this->unauthorized();
		}

		$server_id = (int)$server['id'];

		if (1 === (int)$server['paused']) {
			return $this->paused();
		}

		// 注册前顺带清理过期连接行（task1）：过期行是「断开即离线」的兜底，
		// 表里最多每服务器一行，全表清理成本可忽略
		$repository->cleanupServerConnections();

		// Hub 生成的随机连接标识：注册表只认它，不存 Agent Token 明文——
		// Token 是高价值凭据，任何表都不落明文（PRD §5.6）
		$connection_id = bin2hex(random_bytes(16));

		if (!$repository->registerServerConnection($server_id, $connection_id, self::CONNECTION_TTL)) {
			// 注册失败（事务回滚，基本只会是数据库异常）：无法保证「每 Token
			// 单活跃连接」的语义，宁可直接失败让 agent 退避重连，也不持有一条
			// 不受注册表约束的连接
			return data([
				'success' => false,
				'message' => '连接注册失败，请稍后重连',
				'error' => '连接注册失败，请稍后重连',
			], 500);
		}

		$this->beginStream();

		// 客户端断开后照常走完退出路径（清理注册行）：mod_php 默认在下次写
		// 输出时直接终止脚本，那样「断开即离线」只剩 TTL 兜底，不是秒级
		// （PRD §5.2 / 决策 D11）
		ignore_user_abort(true);

		$next_collect_at = $this->nextCollectAt($server['last_report_at'] ?? null);
		$deadline = time() + self::HOLD_SECONDS;
		$superseded = false;

		while (time() < $deadline) {
			// 采集指令到期下发：连接建立后的第一次迭代即覆盖「已满一个采集
			// 周期，立即下发」的场景；之后每 5 分钟一次
			if (time() >= $next_collect_at) {
				$this->writeLine(['cmd' => 'collect']);
				$next_collect_at = time() + self::COLLECT_INTERVAL;
			}

			// 每秒保活 + 断开自检：必须先写输出再 connection_aborted()，
			// 否则感知不到对端已消失（见 keepAlive() 注释）
			if (!$this->keepAlive()) {
				break;
			}

			// 每秒校验自己的连接是否仍活跃：被新连接挤占（自己的行已被顶替）
			// 或意外过期都算失效，退出让 agent 重连（PRD §5.2）
			if (!$repository->isServerConnectionActive($server_id, $connection_id)) {
				// 区分「被挤占」与「自身过期」：表里存在别人的活跃连接即被挤占，
				// 结束行带 reason 让 agent 退避；自身过期（理论上不会发生，
				// TTL 60s > 持有 50s）则立即重连
				$superseded = null !== $repository->getActiveServerConnectionId($server_id);
				break;
			}

			sleep(1);
		}

		// 清理自己的注册行：按 connection_id 精确删除，被挤占时自己的行早已
		// 不在表里，这条 DELETE 是空操作，不会误删挤占者的新行。不等 TTL
		// 过期——否则重连空档里服务器仍显示在线（PRD §5.2 秒级离线）
		$repository->deleteServerConnection($server_id, $connection_id);

		// 结束行：正常到期 = 立即重连；被挤占 = 带 reason 退避重连
		$final = ['ok' => true, 'action' => 'reconnect'];
		if ($superseded) {
			$final['reason'] = 'superseded';
		}
		$this->writeLine($final);

		// 响应体已按行流式输出完毕：返回空 yield() 的响应，避免框架的
		// DataResponse 再发一次头部（headers already sent）与响应体。
		// 用匿名类而不是改框架：本任务的改动范围只有本文件
		return new class implements ResponseInterface {
			public function yield(): void
			{
				// 流式长轮询：状态码 / 头部 / 响应体均由控制器直接输出
			}
		};
	}

	/**
	 * Token 校验：枚举全部服务器逐条 verify（Utils\ServerToken）
	 *
	 * 盐每服务器随机，无法按 Token 哈希直接检索，只能全量枚举后逐条比对；
	 * 个人级 < 20 台（PRD §5.5）成本可忽略。命中返回该服务器的行（含
	 * paused / last_report_at，供后续流程使用），未命中返回 null——「无效
	 * Token」与「服务器不存在」在此合流，由 unauthorized() 给出逐字节
	 * 一致的 401（PRD §5.6：响应体与耗时都要一致，防枚举）。
	 */
	private function authenticate(Repository $repository, string $token): ?array
	{
		foreach ($repository->getServerTokenMaterials() as $candidate) {
			if (ServerToken::verify($token, (string)$candidate['token_hash'], (string)$candidate['token_salt'])) {
				return $candidate;
			}
		}

		// 未命中：补一次虚拟哈希比对拉平耗时（固定值材料见类常量注释），
		// 让空库 / 有库两种部署下的失败路径都有同等的哈希运算量
		ServerToken::verify(self::DUMMY_TOKEN, self::DUMMY_HASH, self::DUMMY_SALT);

		return null;
	}

	/**
	 * 401：无效 Token 与不存在服务器共用同一分支
	 *
	 * 信封形态与框架的 JSON 错误响应一致（{ success, message, error }），
	 * 但直接以 data() 返回而不抛 UnauthorizedException：异常路径会按请求的
	 * Accept 头决定返回 JSON 还是 HTML 错误页，agent（Go http client）默认
	 * 不带 Accept: application/json，会拿到无法解析的 HTML。
	 */
	private function unauthorized(): ResponseInterface
	{
		return data([
			'success' => false,
			'message' => self::UNAUTHORIZED_MESSAGE,
			'error' => self::UNAUTHORIZED_MESSAGE,
		], 401);
	}

	/**
	 * 403：服务器已暂停（paused=1）
	 *
	 * 选 403 而不是「保持连接但不下发指令」：暂停期间 Hub 没有任何数据要
	 * 下发，占持一个 Apache worker 50s 纯属浪费；403 同时给 agent 一个与
	 * 401 可区分的明确信号（401 = Token 失效，停止重连；403 = 暂停，保持
	 * 守护并按退避重试，用户恢复后自然接入）。「暂停期间不做离线判定」由
	 * ServerPayload::resolveStatus() 的 paused 优先级保证（PRD §5.1），与
	 * 本端点是否注册连接无关。
	 */
	private function paused(): ResponseInterface
	{
		return data([
			'success' => false,
			'message' => '服务器已暂停监控',
			'error' => '服务器已暂停监控',
		], 403);
	}

	/**
	 * 发送流式响应头（仅在确定进入长轮询后调用）
	 *
	 * x-ndjson：下行信道是按行读取的 JSON 流（协议见类注释）；
	 * X-Accel-Buffering: no：关掉前置 nginx 的响应缓冲，否则采集指令会被
	 * 压在代理侧迟迟发不出去（Caddy 等其它反代忽略该头，无副作用）。
	 */
	private function beginStream(): void
	{
		if (headers_sent()) {
			return;
		}

		http_response_code(200);
		header('Content-Type: application/x-ndjson; charset=utf-8');
		header('Cache-Control: no-cache, no-store, must-revalidate');
		header('Pragma: no-cache');
		header('X-Accel-Buffering: no');
	}

	/**
	 * 保活：输出一个空行并 flush，随后自检客户端是否已断开
	 *
	 * 每秒执行一次。必须先写输出再调 connection_aborted()——mod_php 下
	 * 连接状态只有在写输出时才更新，不写输出就永远感知不到对端已消失，
	 * 「断开即离线（秒级）」无从兑现（PRD §5.2）。空行本身对 agent 无
	 * 语义（协议约定跳过），仅用于维持连接与触发状态更新。
	 */
	private function keepAlive(): bool
	{
		echo "\n";
		flush();

		return !connection_aborted();
	}

	/**
	 * 输出一行协议 JSON 并立即 flush（agent 按行读取）
	 */
	private function writeLine(array $payload): void
	{
		echo json_encode($payload) . "\n";
		flush();
	}

	/**
	 * 计算下一次采集指令的下发时间戳（PRD §5.2 / 决策 D4）
	 *
	 * 连接建立即判定：已满一个采集周期（last_report_at 距今 ≥ 5 分钟）或
	 * 从未回传 → 立即下发（返回当前时间，循环第一次迭代即发出）；未满则
	 * 返回到期时刻——若在本次 50s 持有内到期则到点下发，否则留给下次重连
	 * 再判定。时间取服务端时钟，与 last_report_at 的落库时间同一时区
	 * （bootstrap 设 Asia/Shanghai），不信任客户端时钟（PRD §5.2）。
	 */
	private function nextCollectAt(?string $last_report_at): int
	{
		if (null === $last_report_at || '' === $last_report_at) {
			return time();
		}

		$last = strtotime($last_report_at);
		if (false === $last) {
			// 脏数据按「从未回传」处理：立即采一次，比永远不采更安全
			return time();
		}

		return max(time(), $last + self::COLLECT_INTERVAL);
	}
}
