// 快照组装与全量采集入口（口径：PRD docs/prd/server.md §5.3「采集指标」）
//
// Snapshot 的 JSON 字段名与 controllers/AgentReportController.php 的字段
// 白名单**逐字段对齐**（该文件是唯一事实源）：指标 12 字段 + disks[] +
// docker[] + 系统信息 5 字段。白名单外字段（arch）Hub 会忽略（向前兼容）。
// 时间戳不放在快照里：received_at 一律取服务端接收时间，不信任客户端时钟
// （PRD §5.2 / §8，AgentReportController 文件头注释）。

package main

// DockerContainer Docker 容器指标（字段与 AgentReportController::parseDocker
// 白名单一致）。采集实现见 docker.go（Docker Engine API；不可用时同样留空，
// 不影响其余指标——PRD §5.3）。
type DockerContainer struct {
	Container string  `json:"container"`
	Cpu       float64 `json:"cpu"`
	MemUsed   uint64  `json:"mem_used"`
	MemLimit  uint64  `json:"mem_limit"`
	NetRx     uint64  `json:"net_rx"`
	NetTx     uint64  `json:"net_tx"`
	State     string  `json:"state"`
}

// Snapshot 一次全量采集的机器状态（PRD §5.3）
type Snapshot struct {
	// 基础指标（server_metrics 12 列）
	CPU       float64 `json:"cpu"`        // 百分比 0–100
	MemUsed   uint64  `json:"mem_used"`   // 字节
	MemTotal  uint64  `json:"mem_total"`  // 字节
	MemCached uint64  `json:"mem_cached"` // 字节，buff/cache 口径
	SwapUsed  uint64  `json:"swap_used"`  // 字节
	SwapTotal uint64  `json:"swap_total"` // 字节
	Load1     float64 `json:"load1"`      // 1 分钟负载
	Load5     float64 `json:"load5"`      // 5 分钟负载
	Load15    float64 `json:"load15"`     // 15 分钟负载
	NetRx     uint64  `json:"net_rx"`     // 速率 bytes/s（agent 侧算好）
	NetTx     uint64  `json:"net_tx"`     // 速率 bytes/s
	Uptime    uint64  `json:"uptime"`     // 开机秒数

	Disks  []DiskUsage       `json:"disks"`  // 各挂载点 used / total
	Docker []DockerContainer `json:"docker"` // Docker Engine API 采集，见 docker.go

	// 系统信息（servers 冗余列；Hub 侧「传入即覆盖」，见 parseSystemInfo 注释）
	Os           string `json:"os"`            // 发行版（/etc/os-release PRETTY_NAME）
	Kernel       string `json:"kernel"`        // 内核版本
	Cores        int    `json:"cores"`         // CPU 核数
	Arch         string `json:"arch"`          // CPU 架构（白名单外字段，Hub 忽略）
	Ip           string `json:"ip"`            // 默认路由对应的本机 IPv4（/proc/net/fib_trie 解析，见 ip.go）
	AgentVersion string `json:"agent_version"` // main.go 的 version，-ldflags 注入（决策 D12）
}

// Collector 全量采集器：CPU / 网络需要两次采样，由本结构持有基线；其余
// 采集（内存 / 磁盘 / 负载 / 开机时长 / 系统信息）无状态，每次直读。
//
// 生命周期：task19 在 agent 启动时构造一个实例，之后每个 collect 指令调一
// 次 CollectAll（CPU / 网络自第二次采样起才是真实值，首采样按 PRD §5.3
// 报 0 并建立基线）。
type Collector struct {
	cpu    *CPUSampler
	net    *NetworkSampler
	docker *DockerCollector
}

// NewCollector 构造采集器
func NewCollector() *Collector {
	return &Collector{
		cpu:    NewCPUSampler(),
		net:    NewNetworkSampler(),
		docker: NewDockerCollector(),
	}
}

// CollectAll 组装一次全量快照
//
// 单点失败降级策略（各采集器统一约定）：任一采集失败只把自己置零 / 置空并
// 记日志（slog 默认写 stderr，systemd journal 可见），绝不影响其余字段——
// 与 PRD §5.3「Docker 不可用，该字段为空即可，不影响其余指标回传」同款
// 思路；Hub 对缺省 / 全 0 快照照常接收（AgentReportController 注释：落库
// 一行 0 值快照，图表上表现为可见断点），好过整包丢失。
func (c *Collector) CollectAll() Snapshot {
	cpu := c.cpu.Sample()
	mem := collectMemory()
	load := collectLoad()
	net := c.net.Sample()
	system := collectSystemInfo()

	return Snapshot{
		CPU:          cpu,
		MemUsed:      mem.Used,
		MemTotal:     mem.Total,
		MemCached:    mem.Cached,
		SwapUsed:     mem.SwapUsed,
		SwapTotal:    mem.SwapTotal,
		Load1:        load.Load1,
		Load5:        load.Load5,
		Load15:       load.Load15,
		NetRx:        net.Rx,
		NetTx:        net.Tx,
		Uptime:       collectUptime(),
		Disks:        collectDisks(),
		Docker:       c.docker.Collect(),
		Os:           system.Os,
		Kernel:       system.Kernel,
		Cores:        system.Cores,
		Arch:         system.Arch,
		Ip:           collectIP(),
		AgentVersion: version,
	}
}
