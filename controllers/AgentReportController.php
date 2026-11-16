<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\AgentAuth;
use function Framework\data;

/**
 * POST /api/agent/report —— 快照回传（PRD docs/prd/server.md §5.2 / §5.3 / §5.6 / §6）
 *
 * agent（link-agent）每 5 分钟经长连接收到采集指令（协议见 AgentConnectController
 * 文件头注释），采集全量快照后 POST 到本端点。**本类是快照 JSON 字段白名单与
 * 校验规则的唯一事实源**：task18（agent 侧快照组装）与 task19（回传协议）按本节对齐。
 *
 * ── 请求 ────────────────────────────────────────────────────────────
 * POST，body 为 JSON 对象；凭据只走请求头 X-Agent-Token: <token 明文>（同
 * connect，PRD §5.6）。字段白名单（依据 PRD §5.3 全量口径，逐一对应）：
 *   指标：cpu / mem_used / mem_total / mem_cached / swap_used / swap_total /
 *         load1 / load5 / load15 / net_rx / net_tx / uptime
 *   磁盘：disks[]   = { mount, used, total }
 *   Docker：docker[] = { container, cpu, mem_used, mem_limit, net_rx, net_tx, state }
 *   系统信息：os / kernel / cores / ip / agent_version
 * 白名单外的字段一律**忽略**（向前兼容：新版本 agent 新增指标不会被旧 Hub
 * 整包拒绝；不读即不入库，注入面不收窄）；但白名单内字段的**结构性越界**
 * （超长 / 非法字符 / 非对象数组项）按 PRD §5.6 拒绝整包，见各 parse 方法。
 * 对 agent 的硬性要求：body 必须是 JSON **对象**且带 Content-Type:
 * application/json——非法 JSON 或非对象顶层（数字 / 字符串 / null）会被框架
 * 的 getInput() 先于本控制器拒绝，返回 400 但信封是 {success:false,...}
 * （仍是 JSON，agent 对 4xx 统一按「丢弃本轮、下周期重传」处理即可）。
 *
 * ── 响应（agent 态信封，与用户态 success 信封区分，dev-plan task7）────────
 * 200 {"ok":true}：快照已在一个事务内落库；
 * 400 {"ok":false,"message":"..."}：包体超限 / JSON 非法 / 字段越界；
 * 401：Token 无效或服务器不存在——与 connect 逐字节一致（共用 Utils\AgentAuth）；
 * 500 {"ok":false,"message":"..."}：落库失败（事务已回滚，agent 下一周期重传）。
 *
 * ── 时间戳（PRD §5.2 / §8）──────────────────────────────────────────
 * received_at 一律取**服务端接收时间**，不信任客户端时钟：客户端即便携带
 * timestamp 字段也不在白名单内、直接忽略——按客户端时间排序会让 30 天清理
 * 边界（决策 D4）与图表横轴被一台时钟不准的机器带偏，且库内没有列存它，
 * 记录只会诱导按客户端时间消费的 bug。
 *
 * ── 单包大小上限（PRD §5.6「防 SQLite 膨胀」）────────────────────────
 * 1MB：正常快照（1 行指标 + 数十磁盘 + 数百容器行）在 100KB 量级，1MB 已是
 * 数量级余量；上限的意义是防异常 / 恶意大包把明细表撑爆（server_docker 行数
 * = 天数 × 288 × 容器数，本来就是增长最快的一张表，PRD §5.4）。
 */
class AgentReportController implements ControllerInterface
{
	/**
	 * 单包大小上限（字节）：1MB
	 *
	 * 超限直接 400，不做截断——截断 JSON 只会得到非法包，没有「保留一半」
	 * 的语义。注意框架的 getInput() 会按 Content-Type 预读整个 body，本上限
	 * 无法阻止框架层缓冲，收口的是「进入校验与入库的数据量」。
	 */
	private const MAX_BODY_BYTES = 1048576;

	/**
	 * Docker 容器数量上限：200
	 *
	 * 个人级单机容器数远低于此；超出只可能是采集异常（Docker API 返回异常
	 * 列表）。选**拒绝**而非截断：截断会静默丢掉排在后面的容器，让用户误以为
	 * 机器上没有这些容器；拒绝让 agent 与用户立刻发现异常。
	 */
	private const MAX_DOCKER_CONTAINERS = 200;

	/** 挂载点路径长度上限：Linux PATH_MAX 4096，真实挂载点远小于此，255 足够 */
	private const MAX_MOUNT_LENGTH = 255;

	/** 容器名长度上限：与服务器名称等同量级（190，见 Utils\ServerPayload） */
	private const MAX_CONTAINER_LENGTH = 190;

	/** 发行版 / 内核版本字符串上限（uname -a 与 os-release PRETTY_NAME 的量级） */
	private const MAX_OS_LENGTH = 190;
	private const MAX_KERNEL_LENGTH = 190;

	/** IP 上限：IPv6 地址最大 45 字符（PRD §5.3 系统信息口径） */
	private const MAX_IP_LENGTH = 45;

	/** agent 版本号上限：与主版本同 tag 的语义化版本（决策 D12），32 字符足够 */
	private const MAX_VERSION_LENGTH = 32;

	/**
	 * CPU 核数上限：1024
	 *
	 * 真实单机（含小型机）远低于此；超限按脏数据截断，防止「CPU 核数」在
	 * 列表卡片上显示成天文数字。
	 */
	private const MAX_CPU_CORES = 1024;

	/**
	 * Docker 容器状态白名单：Docker Engine API /containers/json 的 State
	 * 封闭枚举（created / running / paused / restarting / removing / exited /
	 * dead）。state 是结构性字段（PRD §5.6）：白名单外值说明数据被构造或
	 * agent 版本异常，拒绝而非截断。
	 */
	private const DOCKER_STATES = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'];

	/**
	 * POST /api/agent/report
	 *
	 * 流程：Token 校验（401 与 connect 逐字节一致）→ 单包大小与 JSON 形态
	 * 校验（400）→ 白名单字段解析与范围 / 结构校验（400）→ 一个事务内写入
	 * 三张明细表并刷新 servers 冗余列（500 时已回滚）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$token = trim((string)($_SERVER['HTTP_X_AGENT_TOKEN'] ?? ''));

		// 认证与 401 拉平逻辑与 connect 共用 Utils\AgentAuth（PRD §5.6：两端点
		// 的失败响应逐字节一致，防枚举）
		$server = AgentAuth::authenticate($repository, $token);
		if (null === $server) {
			return AgentAuth::unauthorized();
		}

		// 暂停中的服务器照常接收回传：暂停只停「离线判定与展示置灰」，历史数据
		// 保留（PRD §5.1），恢复由用户操作。本端点不读写 paused——回传是数据
		// 通道，不是控制通道（与 connect 的 403 语义不同）
		$server_id = (int)$server['id'];

		// 直接读原始 body 而不复用框架解析好的 $input：单包上限必须按原始
		// 字节数判定；同时不把查询串合并进来——agent 端点的入参只应来自 body
		$raw = file_get_contents('php://input');
		if (false === $raw) {
			return $this->reject('无法读取回传内容');
		}
		if ('' === $raw) {
			return $this->reject('回传内容为空');
		}

		if (strlen($raw) > self::MAX_BODY_BYTES) {
			return $this->reject('回传包超过大小上限');
		}

		$payload = json_decode($raw, true);
		// 顶层必须是 JSON 对象：数组形态（如 [1,2]）按非法包拒绝；{} 解码后
		// 与空数组同形，按「全字段缺省」放过（落库一行 0 值快照，agent 侧
		// 的采集异常在图表上是可见的 0 值断点）
		if (!is_array($payload) || (array_is_list($payload) && [] !== $payload)) {
			return $this->reject('回传内容必须是 JSON 对象');
		}

		try {
			$metrics = $this->parseMetrics($payload);
			$disks = $this->parseDisks($payload);
			$containers = $this->parseDocker($payload);
			$system_info = $this->parseSystemInfo($payload);
		} catch (ValidationException $e) {
			// 400 不走框架异常出口：异常响应会按 Accept 头在 JSON 与 HTML 错误页
			// 之间二选一，agent（Go http client）默认不带 Accept: application/json，
			// 会拿到无法解析的 HTML（同 AgentAuth::unauthorized() 的返回理由）
			return $this->reject($e->getMessage());
		}

		$written = $repository->insertServerSnapshot($server_id, $metrics, $disks, $containers, $system_info);

		if (!$written) {
			return data(['ok' => false, 'message' => '回传写入失败，请稍后重试'], 500);
		}

		return data(['ok' => true]);
	}

	/**
	 * 解析基础指标（白名单依据 PRD §5.3，逐字段对应采集口径表）
	 *
	 * 范围校验口径（PRD §5.6「数值字段截断」）：
	 * - cpu 截断到 0–100（/proc/stat 增量口径的百分比）；
	 * - mem_used ≤ mem_total、swap_used ≤ swap_total：gopsutil Used 口径偶发
	 *   大于 Total（PRD §5.3 提到 beszel 仅在此时回退 Total − Available），
	 *   按 total 截断，不让单点异常丢掉整包；
	 * - load1/5/15、net_rx/tx（速率 bytes/s）、uptime 非负，负值截断到 0；
	 * - 类型错误（布尔 / 数组 / 对象 / 非数字串 / NaN / Inf）**拒绝整包**：
	 *   这不是「超范围」而是「不是数」，截断没有合法边界可循；
	 * - 缺省字段按 0 落库（与 Repository::insertServerMetrics 的默认一致）。
	 */
	private function parseMetrics(array $payload): array
	{
		$cpu = $this->number($payload, 'cpu', 0.0);
		$mem_used = $this->bytes($payload, 'mem_used');
		$mem_total = $this->bytes($payload, 'mem_total');
		$mem_cached = $this->bytes($payload, 'mem_cached');
		$swap_used = $this->bytes($payload, 'swap_used');
		$swap_total = $this->bytes($payload, 'swap_total');

		return [
			'cpu' => min(100.0, max(0.0, $cpu)),
			'mem_used' => min($mem_used, $mem_total),
			'mem_total' => $mem_total,
			'mem_cached' => $mem_cached,
			'swap_used' => min($swap_used, $swap_total),
			'swap_total' => $swap_total,
			// 负载无上界：多核高负载下 load15 可以远超 100，只约束非负
			'load1' => max(0.0, $this->number($payload, 'load1', 0.0)),
			'load5' => max(0.0, $this->number($payload, 'load5', 0.0)),
			'load15' => max(0.0, $this->number($payload, 'load15', 0.0)),
			// bytes() 内部已把负值收敛到 0，无需再截断
			'net_rx' => $this->bytes($payload, 'net_rx'),
			'net_tx' => $this->bytes($payload, 'net_tx'),
			'uptime' => $this->bytes($payload, 'uptime'),
		];
	}

	/**
	 * 解析磁盘数组（白名单依据 PRD §5.3：mount / used / total）
	 *
	 * 结构性规则（PRD §5.6「结构性字段超限拒绝」）：
	 * - mount 是挂载点路径：非空、≤255 字符、不含控制字符——它会原样进入
	 *   详情页渲染，控制字符是注入与日志伪造的面，必须堵死；
	 * - 同一快照内重复 mount **拒绝**：agent 侧已按 (major:minor) 去重
	 *   （PRD §5.3），重复出现说明去重失效或包被构造，静默「只留最后一条」
	 *   会把异常洗成正常数据，拒绝让问题暴露；
	 * - used > total 按 total 截断（df -P 口径下恒 used ≤ total，越界即采集
	 *   异常，截断后该行仍是可用样本）；
	 * - Docker 不可用 / 无磁盘时传空数组或不传，不影响其余指标（PRD §5.3）。
	 */
	private function parseDisks(array $payload): array
	{
		if (!array_key_exists('disks', $payload) || null === $payload['disks']) {
			return [];
		}

		$disks = $payload['disks'];
		if (!is_array($disks)) {
			throw new ValidationException('disks 字段必须是数组', 400);
		}

		$seen = [];
		$result = [];
		foreach ($disks as $entry) {
			if (!is_array($entry)) {
				throw new ValidationException('disks 每一项必须是对象', 400);
			}

			$mount = $this->text($entry, 'mount', self::MAX_MOUNT_LENGTH, '挂载点');
			if (isset($seen[$mount])) {
				throw new ValidationException("同一快照内挂载点重复：{$mount}", 400);
			}
			$seen[$mount] = true;

			$total = $this->bytes($entry, 'total');
			$result[] = [
				'mount' => $mount,
				'used' => min($this->bytes($entry, 'used'), $total),
				'total' => $total,
			];
		}

		return $result;
	}

	/**
	 * 解析 Docker 容器数组（白名单依据 PRD §5.3：container / cpu / mem_used /
	 * mem_limit / net_rx / net_tx / state）
	 *
	 * 除数量上限（见 MAX_DOCKER_CONTAINERS）外的规则：
	 * - container 名限定 [A-Za-z0-9._-]（Docker 名称字符集）：拒绝空白 /
	 *   引号 / 路径分隔等，与 mount 同属结构性字段（PRD §5.6）；
	 * - state 取 Docker Engine API 封闭枚举白名单（见 DOCKER_STATES），
	 *   白名单外值拒绝；大小写归一为小写；
	 * - 同一快照内重复容器名**拒绝**：Docker 名称在 daemon 上全局唯一，
	 *   重复即异常（与 mount 同理）；
	 * - cpu 按百分比截断到 0–100（PRD §5.3：容器 CPU = 容器增量 ÷ system
	 *   增量 × 100，不乘核数）；
	 * - mem_used > mem_limit 时截断；mem_limit 为 0 表示无限制（cgroup v1
	 *   语义），此时不截断；
	 * - Docker 不可用时传空数组或不传，不影响其余指标（PRD §5.3）。
	 */
	private function parseDocker(array $payload): array
	{
		if (!array_key_exists('docker', $payload) || null === $payload['docker']) {
			return [];
		}

		$containers = $payload['docker'];
		if (!is_array($containers)) {
			throw new ValidationException('docker 字段必须是数组', 400);
		}

		if (count($containers) > self::MAX_DOCKER_CONTAINERS) {
			throw new ValidationException('docker 容器数量超过上限 ' . self::MAX_DOCKER_CONTAINERS, 400);
		}

		$seen = [];
		$result = [];
		foreach ($containers as $entry) {
			if (!is_array($entry)) {
				throw new ValidationException('docker 每一项必须是对象', 400);
			}

			$name = $this->text($entry, 'container', self::MAX_CONTAINER_LENGTH, '容器名');
			if (!preg_match('/^[A-Za-z0-9_.-]+$/', $name)) {
				throw new ValidationException("容器名含有非法字符：{$name}", 400);
			}
			if (isset($seen[$name])) {
				throw new ValidationException("同一快照内容器名重复：{$name}", 400);
			}
			$seen[$name] = true;

			$state = strtolower(trim((string)($entry['state'] ?? '')));
			if (!in_array($state, self::DOCKER_STATES, true)) {
				// 截断后再回显：未过白名单的 state 原值长度不受约束，避免 400
				// 响应体被异常输入放大（主体大小已由单包 1MB 收口，这里只是
				// 不让错误消息反射原始大值）
				$shown = mb_substr($state, 0, 64);
				throw new ValidationException("容器状态不在合法枚举内：{$shown}", 400);
			}

			$mem_limit = $this->bytes($entry, 'mem_limit');
			$mem_used = $this->bytes($entry, 'mem_used');
			if ($mem_limit > 0) {
				$mem_used = min($mem_used, $mem_limit);
			}

			$result[] = [
				'container' => $name,
				'cpu' => min(100.0, max(0.0, $this->number($entry, 'cpu', 0.0))),
				'mem_used' => $mem_used,
				'mem_limit' => $mem_limit,
				'net_rx' => $this->bytes($entry, 'net_rx'),
				'net_tx' => $this->bytes($entry, 'net_tx'),
				'state' => $state,
			];
		}

		return $result;
	}

	/**
	 * 解析系统信息（白名单依据 PRD §5.3：os / kernel / cores / ip / agent_version）
	 *
	 * 键名是回传 JSON 的字段名，值映射到 servers 冗余列（PRD §6 允许冗余）：
	 * os → os_name、kernel → kernel、cores → cpu_cores、ip → ip_address、
	 * agent_version → agent_version。
	 *
	 * 更新策略选「传入即覆盖」而非「变化时更新」：agent 侧本就只在首次或
	 * 变化时回传这些字段（PRD §5.3），实际写入量相同；Hub 侧比较变化需要
	 * 先读库一次，收益不抵成本。缺省 / null / 空串的字段不更新，保留 servers
	 * 上的原值。structural 规则同磁盘：超长 / 控制字符拒绝整包（PRD §5.6）。
	 */
	private function parseSystemInfo(array $payload): array
	{
		$system = [];

		$text_map = [
			'os' => ['os_name', self::MAX_OS_LENGTH, '发行版'],
			'kernel' => ['kernel', self::MAX_KERNEL_LENGTH, '内核版本'],
			'ip' => ['ip_address', self::MAX_IP_LENGTH, 'IP 地址'],
			'agent_version' => ['agent_version', self::MAX_VERSION_LENGTH, 'agent 版本'],
		];
		foreach ($text_map as $key => [$column, $max_length, $label]) {
			$value = $payload[$key] ?? null;
			if (null === $value) {
				continue;
			}
			if (is_string($value) && '' === trim($value)) {
				// 显式空串视为「无更新」，保留 servers 原值
				continue;
			}
			$system[$column] = $this->text($payload, $key, $max_length, $label);
		}

		$cores = $payload['cores'] ?? null;
		if (null !== $cores) {
			$system['cpu_cores'] = (int)min(max(0.0, $this->number($payload, 'cores', 0.0)), (float)self::MAX_CPU_CORES);
		}

		return $system;
	}

	/**
	 * 400 拒绝：agent 态信封 { ok: false, message }
	 *
	 * 不用框架的 ValidationException 出口：异常响应会按请求的 Accept 头在
	 * JSON 与 HTML 错误页之间二选一，agent（Go http client）默认不带
	 * Accept: application/json，会拿到无法解析的 HTML。
	 */
	private function reject(string $message): ResponseInterface
	{
		return data(['ok' => false, 'message' => $message], 400);
	}

	/**
	 * 取数值字段：缺省 / null 回落默认值，类型错误与非有限值抛 400
	 *
	 * 宽容接收 JSON 数字与数字字符串（Go 编码为 JSON 数字；命令行调试可能带
	 * 字符串），拒绝布尔 / 数组 / 对象 / 非数字串。NaN / Inf 拒绝：JSON 本身
	 * 不表达它们（json_decode 只在 1e400 这类字面量上产出 Inf），入库后会让
	 * 图表与聚合全部失真。
	 */
	private function number(array $payload, string $key, float $default): float
	{
		if (!array_key_exists($key, $payload) || null === $payload[$key]) {
			return $default;
		}

		$value = $payload[$key];
		if (!is_int($value) && !is_float($value) && !(is_string($value) && is_numeric($value))) {
			throw new ValidationException("字段 {$key} 必须是数字", 400);
		}

		$number = (float)$value;
		if (!is_finite($number)) {
			throw new ValidationException("字段 {$key} 必须是有限数值", 400);
		}

		return $number;
	}

	/**
	 * 取字节 / 秒数字段：非负、有限，且收敛到 SQLite INTEGER 范围
	 *
	 * 上界截断到 PHP_INT_MAX：JSON 能表达远超 64 位整数的浮点（如 1e30），
	 * 直接 (int) 强转会得到未定义值、入库后图表全废；物理上也不存在这么大
	 * 的字节数，截断比拒绝更符合「数值字段截断」原则（PRD §5.6）。
	 */
	private function bytes(array $payload, string $key): int
	{
		$value = $this->number($payload, $key, 0.0);

		if ($value <= 0) {
			return 0;
		}

		// 边界值单独返回：2^63 作为 float 恰好是 (float)PHP_INT_MAX，强转会
		// 得到未定义值，必须先判等再返回整数常量
		if ($value >= (float)PHP_INT_MAX) {
			return PHP_INT_MAX;
		}

		return (int)$value;
	}

	/**
	 * 取结构性文本字段：必须是字符串、trim 后非空、不超长、不含控制字符
	 *
	 * 控制字符（含 \n \t \0）会原样进入详情页渲染与日志上下文，是注入与日志
	 * 伪造的面；PRD §5.6 将这类字段划为「结构性字段，超限拒绝」。
	 */
	private function text(array $payload, string $key, int $max_length, string $label): string
	{
		$value = $payload[$key] ?? null;
		if (!is_string($value)) {
			throw new ValidationException("{$label}（{$key}）必须是字符串", 400);
		}

		$value = trim($value);
		if ('' === $value) {
			throw new ValidationException("{$label}（{$key}）不能为空", 400);
		}

		if (mb_strlen($value, 'UTF-8') > $max_length) {
			throw new ValidationException("{$label}（{$key}）不能超过 {$max_length} 个字符", 400);
		}

		if (preg_match('/[\x00-\x1F\x7F]/', $value)) {
			throw new ValidationException("{$label}（{$key}）含有非法控制字符", 400);
		}

		return $value;
	}
}
