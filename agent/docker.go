// Docker 采集器（口径：PRD docs/prd/server.md §5.3「Docker 指标」；数值口径
// 对照 docs/beszel/agent/docker.go，只参考口径、不拷代码）
//
// 数据源为 Docker Engine API（不用 docker stats CLI，PRD §5.3 定稿）：
//   - GET /containers/json                     容器列表（Id / Names / State / Status）
//   - GET /containers/{id}/stats?stream=false  单次统计快照（one-shot）
//
// 三项指标口径（PRD §5.3，与 docker stats 显示值一致）：
//   - CPU：容器 cpu 增量 ÷ system 增量 × 100，**不乘 CPU 核数**——API 的
//     system_cpu_usage 是全 CPU（所有核）累计值，乘核数会双算、结果超
//     100%（beszel 对乘核数的口径直接丢弃该样本）。100% 语义 = 占满全部核心；
//   - 内存：memory.stats.usage − memory.stats.inactive_file——inactive_file
//     是可回收页缓存，不计入容器实际占用；inactive_file 缺失（cgroup v1
//     老内核不报）时回退 cache 字段（beszel 同款兜底）；
//   - 网络：networks 各接口累计收发增量之和 ÷ 实际间隔（bytes/s，与基础
//     网络 network.go 同口径，PRD §5.3：由 agent 侧算好速率，Hub 不换算）。
//
// 增量基线策略：**自维护进程内上次累计值（按容器 id）**，不依赖 one-shot
// 响应里的 precpu_stats。原因：one-shot 的 precpu_stats 语义不可靠——容器
// 刚启动后的首次请求 precpu 常为零，各 daemon 版本清空时机也不一致，为零
// 时公式会退化成「开机以来累计比值」（cpuDelta=容器累计 ÷ systemDelta=系统
// 累计）而非本间隔速率；且网络累计值本来就必须自维护基线（precpu_stats
// 不含 networks）。自维护后 CPU / 网络口径统一，并与 cpu.go / network.go
// 的「两次采样增量 ÷ 实际间隔」同构：首采样报 0 建基线，计数器重置
// （cur < prev）本次报 0 并重建基线。
//
// 跨平台取舍同 cpu.go / network.go：不写 //go:build linux。unix socket 的
// net.Dial("unix", ...) 在 Windows 上可编译（net 包自带 AF_UNIX 实现，
// Go 1.12 起支持），运行期拨号失败即走「Docker 不可用」降级路径；agent 按
// 决策 D8 只部署在 Linux。http.Client 与 BaseURL 可注入：单测用 httptest
// server 直连，不碰真实 socket。

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	// dockerRequestTimeout Docker API 单请求超时：采集不能拖垮 task19 的
	// 回传循环。socket 不存在时拨号立即失败（不等超时）；该值主要兜底僵死
	// 的 daemon（beszel 取 2.1s；本探针 5 分钟一采、容器数少，放宽到 5s）
	dockerRequestTimeout = 5 * time.Second

	// defaultDockerSocket 默认 Docker Engine API socket：被监控机本机
	// daemon（安装脚本以 root 运行，socket 属主 root:docker，可拨）
	defaultDockerSocket = "/var/run/docker.sock"

	// dockerBaseHost unix transport 的占位 Host：连接由 Transport 的
	// DialContext 拨到 socket 路径，URL 的 Host 不参与寻址（beszel 同款
	// 技巧），固定 http://localhost 即可
	dockerBaseHost = "http://localhost"

	// dockerShortIDLength 容器短 id 长度：Names 缺失的畸形条目回退展示
	// （docker ps 的短 id 同为 12 位）
	dockerShortIDLength = 12
)

// DockerCollector Docker 容器指标采集器。
// 非并发安全：采集由 Hub 的 collect 指令串行触发，单 goroutine 使用
// （与 CPUSampler / NetworkSampler 同约定）。
type DockerCollector struct {
	// client Docker Engine API 客户端（生产为 unix socket transport；
	// 单测注入 httptest server 的 client）
	client *http.Client
	// baseURL API 根地址（生产为占位 Host；单测注入 httptest 地址）
	baseURL string
	// socketPath unix socket 路径：仅用于降级日志定位（baseURL 注入时为空串）
	socketPath string
	// now 时钟注入点：测试控制采集间隔，避免真实 sleep（同 NetworkSampler）
	now func() time.Time

	// 进程内增量基线（按容器 id，策略见文件头注释）
	lastCPU map[string]dockerCPUCounter // 容器 id → CPU 累计值
	lastNet map[string]dockerNetCounter // 容器 id → 网络累计值
	// lastAt 容器 id → 上次成功采样时刻：网络速率的分母。按容器独立记录
	// （而非整轮一个时刻）：单容器某轮 stats 失败时基线不动，下一轮的
	// 增量与间隔仍自洽，不会把两轮增量按一轮间隔压缩成虚高速率
	lastAt map[string]time.Time
}

// dockerCPUCounter 容器 CPU 累计计数器（stats.cpu_stats 口径，单位纳秒；
// system 为同期全 CPU 累计值，用于把容器占用折算成占全部核心的比例）
type dockerCPUCounter struct {
	container uint64
	system    uint64
}

// dockerNetCounter 容器网络累计字节（networks 各接口之和）
type dockerNetCounter struct {
	rx uint64
	tx uint64
}

// dockerContainerEntry GET /containers/json 的一项（只解析需要的字段）
type dockerContainerEntry struct {
	Id     string   `json:"Id"`
	Names  []string `json:"Names"`
	State  string   `json:"State"`
	Status string   `json:"Status"`
}

// dockerContainerStats GET /containers/{id}/stats?stream=false 的单份快照
// （字段按 Docker Engine API 文档取子集；precpu_stats 不解析——增量基线
// 自维护，见文件头「增量基线策略」）
type dockerContainerStats struct {
	CPUStats    dockerCPUStats                   `json:"cpu_stats"`
	MemoryStats dockerMemoryStats                `json:"memory_stats"`
	Networks    map[string]dockerNetworkCounters `json:"networks"`
}

// dockerCPUStats stats.cpu_stats（只取累计用量与同期系统累计）
type dockerCPUStats struct {
	CPUUsage struct {
		TotalUsage uint64 `json:"total_usage"`
	} `json:"cpu_usage"`
	SystemUsage uint64 `json:"system_cpu_usage"`
}

// dockerMemoryStats stats.memory_stats
type dockerMemoryStats struct {
	Usage uint64             `json:"usage"`
	Stats dockerMemoryDetail `json:"stats"`
	Limit uint64             `json:"limit"`
}

// dockerMemoryDetail stats.memory_stats.stats：cgroup 明细
type dockerMemoryDetail struct {
	// InactiveFile 可回收页缓存：内存口径要减掉的项
	InactiveFile uint64 `json:"inactive_file"`
	// Cache 兜底项：cgroup v1 老内核不报 inactive_file 时改减它（beszel 同款）
	Cache uint64 `json:"cache"`
}

// dockerNetworkCounters 单网卡累计收发字节（stats.networks 的一项）
type dockerNetworkCounters struct {
	RxBytes uint64 `json:"rx_bytes"`
	TxBytes uint64 `json:"tx_bytes"`
}

// NewDockerCollector 构造默认采集器：经 unix socket 连本机 Docker Engine
func NewDockerCollector() *DockerCollector {
	return NewDockerCollectorWithSocket(defaultDockerSocket)
}

// NewDockerCollectorWithSocket 指定 unix socket 路径构造采集器
func NewDockerCollectorWithSocket(socketPath string) *DockerCollector {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			// unix transport：URL 的 Host 只是占位，实际连接拨到 socket 路径
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		},
	}
	return newDockerCollectorWithClient(&http.Client{
		Timeout:   dockerRequestTimeout,
		Transport: transport,
	}, dockerBaseHost, socketPath)
}

// newDockerCollectorWithClient 注入 http.Client 与 BaseURL 的构造入口：
// 单测传 httptest server 的 client 与地址，绕开真实 socket
func newDockerCollectorWithClient(client *http.Client, baseURL, socketPath string) *DockerCollector {
	return &DockerCollector{
		client:     client,
		baseURL:    baseURL,
		socketPath: socketPath,
		now:        time.Now,
		lastCPU:    make(map[string]dockerCPUCounter),
		lastNet:    make(map[string]dockerNetCounter),
		lastAt:     make(map[string]time.Time),
	}
}

// Collect 采集一次容器指标列表
//
// 降级策略（PRD §5.3「Docker 不可用，该字段为空即可，不影响其余指标回传」）：
// 列表请求失败（socket 不存在 / 连接失败 / 超时 / 403 无权限 / 非 200）
// 返回空列表 + warn 日志，绝不向上抛错——快照其余字段照常回传；单容器
// stats 失败时该容器仍上报（名称 / 状态可见），CPU / 内存 / 网络记 0。
func (c *DockerCollector) Collect() []DockerContainer {
	entries, err := c.listContainers()
	if err != nil {
		slog.Warn("Docker 采集失败，本次上报空列表", "error", err, "socket", c.socketPath)
		return []DockerContainer{}
	}

	now := c.now()
	result := make([]DockerContainer, 0, len(entries))
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if entry.Id == "" {
			// 无 Id 既无法请求 stats、也不能作基线键：跳过（Docker 不会返回）
			continue
		}
		seen[entry.Id] = true
		result = append(result, c.collectOne(entry, now))
	}

	// 本轮列表里已消失的容器（删除 / 重启换 id）清理基线，防 map 无限增长
	c.pruneBaselines(seen)
	return result
}

// collectOne 采集单个容器：stats 失败时指标记 0 但保留容器条目
func (c *DockerCollector) collectOne(entry dockerContainerEntry, now time.Time) DockerContainer {
	name := containerDisplayName(entry)
	state := normalizeContainerState(entry)

	stats, err := c.getContainerStats(entry.Id)
	if err != nil {
		slog.Warn("容器 stats 采集失败，本次指标记 0", "container", name, "error", err)
		return DockerContainer{Container: name, State: state}
	}

	elapsed := time.Duration(0)
	if prevAt, ok := c.lastAt[entry.Id]; ok {
		elapsed = now.Sub(prevAt)
	}

	cpu := c.cpuPercent(entry.Id, dockerCPUCounter{
		container: stats.CPUStats.CPUUsage.TotalUsage,
		system:    stats.CPUStats.SystemUsage,
	})
	rxRate, txRate := c.netRates(entry.Id, stats.Networks, elapsed)
	c.lastAt[entry.Id] = now

	return DockerContainer{
		Container: name,
		Cpu:       cpu,
		MemUsed:   containerMemoryUsed(stats.MemoryStats),
		MemLimit:  stats.MemoryStats.Limit,
		NetRx:     rxRate,
		NetTx:     txRate,
		State:     state,
	}
}

// cpuPercent 容器 CPU 百分比 = 容器 cpu 增量 ÷ system 增量 × 100
// （PRD §5.3：不乘核数，原因见文件头）
//
// 无有效增量时返回 0：首采样（无基线）；system 增量为 0（除零保护——间隔内
// 系统计数器纹丝不动，理论不出现，出现即异常样本）；计数器重置
// （cur.container < prev.container，同 id 复用 / 计数器跳变）。先算后更新
// 基线：异常样本本次报 0，基线换成新值，下轮恢复正常。
func (c *DockerCollector) cpuPercent(id string, cur dockerCPUCounter) float64 {
	prev, ok := c.lastCPU[id]
	c.lastCPU[id] = cur
	if !ok {
		return 0
	}
	if cur.system <= prev.system || cur.container < prev.container {
		return 0
	}
	pct := float64(cur.container-prev.container) / float64(cur.system-prev.system) * 100
	// 截断到 0–100：Hub parseDocker 同样截断，双保险（增量口径正常不越界）
	return math.Min(100, math.Max(0, pct))
}

// netRates 容器网络收发速率（bytes/s）= networks 各接口累计增量之和 ÷
// 实际间隔（PRD §5.3，与 network.go 同口径，复用其 counterDelta /
// bytesPerSecond）。首采样 / 零或负间隔报 0；计数器重置（cur < prev）
// 以 cur 为增量——计数器清零重启后从 0 开始，cur 即本间隔增量
// （network.go counterDelta 同款处理）。
func (c *DockerCollector) netRates(id string, networks map[string]dockerNetworkCounters, elapsed time.Duration) (uint64, uint64) {
	cur := sumContainerNetwork(networks)
	prev, ok := c.lastNet[id]
	c.lastNet[id] = cur
	if !ok || elapsed <= 0 {
		return 0, 0
	}
	rx := uint64(math.Round(bytesPerSecond(counterDelta(cur.rx, prev.rx), elapsed)))
	tx := uint64(math.Round(bytesPerSecond(counterDelta(cur.tx, prev.tx), elapsed)))
	return rx, tx
}

// sumContainerNetwork networks 各接口累计收发字节求和（--network none 的
// 容器无 networks 字段，和为 0）
func sumContainerNetwork(networks map[string]dockerNetworkCounters) dockerNetCounter {
	var sum dockerNetCounter
	for _, n := range networks {
		sum.rx += n.RxBytes
		sum.tx += n.TxBytes
	}
	return sum
}

// containerMemoryUsed 容器内存用量 = usage − inactive_file
// （stats.memory.stats 口径，PRD §5.3；beszel calculateMemoryUsage 同款）
//
// 回退与截断：inactive_file 为 0（cgroup v1 老内核不报该字段）时改减
// cache；usage ≤ 可回收量时（采集竞态 / 口径异常）截断为 0 而非丢弃容器
// ——CPU / 网络 / 名称仍是有效信息，Hub 侧 mem_used ≤ mem_limit 也会截断。
func containerMemoryUsed(m dockerMemoryStats) uint64 {
	reclaimable := m.Stats.InactiveFile
	if reclaimable == 0 {
		reclaimable = m.Stats.Cache
	}
	if m.Usage <= reclaimable {
		return 0
	}
	return m.Usage - reclaimable
}

// containerDisplayName 容器展示名：Names[0] 剥掉前导 "/"
// （Docker API 的 Names 形如 ["/nginx"]，前导斜杠不是名字的一部分）
//
// 兜底：Names 为空 / 仅剩斜杠（畸形条目，Docker 不会返回）时退回短 id。
// 保证名字非空且落在 Hub 白名单字符集 [A-Za-z0-9._-] 内
// （AgentReportController::parseDocker：空名 / 非法字符会拒整包）。
func containerDisplayName(entry dockerContainerEntry) string {
	if len(entry.Names) > 0 {
		if name := strings.TrimPrefix(entry.Names[0], "/"); name != "" {
			return name
		}
	}
	id := entry.Id
	if len(id) > dockerShortIDLength {
		id = id[:dockerShortIDLength]
	}
	return id
}

// dockerStateWhitelist 与 AgentReportController::DOCKER_STATES 逐项一致：
// state 是结构性字段，白名单外值会让 Hub 拒整包（PRD §5.6），agent 必须
// 保证只发枚举内值
var dockerStateWhitelist = map[string]bool{
	"created": true, "running": true, "paused": true, "restarting": true,
	"removing": true, "exited": true, "dead": true,
}

// dockerStatusStatePrefixes Status 人类可读串前缀 → State 推导表：
// API State 字段自 1.31 起就有，正常不会走到这里；老 daemon 缺失时从
// "Up 3 hours" / "Exited (0) 2 minutes ago" 这类 Status 前缀推导
var dockerStatusStatePrefixes = []struct {
	prefix string
	state  string
}{
	{"Up", "running"},
	{"Restarting", "restarting"},
	{"Removal", "removing"},
	{"Paused", "paused"},
	{"Created", "created"},
	{"Dead", "dead"},
	{"Exited", "exited"},
}

// normalizeContainerState 归一化容器状态为 Hub 白名单封闭枚举：
// 优先 API State 字段（trim + 小写）；缺失 / 白名单外时从 Status 前缀
// 推导；仍无法确定回落 "exited"（最保守的静止态）并记日志。
func normalizeContainerState(entry dockerContainerEntry) string {
	state := strings.ToLower(strings.TrimSpace(entry.State))
	if dockerStateWhitelist[state] {
		return state
	}
	status := strings.TrimSpace(entry.Status)
	for _, p := range dockerStatusStatePrefixes {
		if strings.HasPrefix(status, p.prefix) {
			return p.state
		}
	}
	slog.Warn("容器状态无法识别，回落 exited",
		"container", containerDisplayName(entry), "state", entry.State, "status", entry.Status)
	return "exited"
}

// pruneBaselines 清理本轮列表已消失的容器 id 的增量基线（容器删除 /
// 重启换 id），防止 map 随容器生命周期无限增长
func (c *DockerCollector) pruneBaselines(seen map[string]bool) {
	for id := range c.lastCPU {
		if !seen[id] {
			delete(c.lastCPU, id)
		}
	}
	for id := range c.lastNet {
		if !seen[id] {
			delete(c.lastNet, id)
		}
	}
	for id := range c.lastAt {
		if !seen[id] {
			delete(c.lastAt, id)
		}
	}
}

// listContainers GET /containers/json：全量容器列表（含已停止的——详情页
// Docker 表要展示 exited 容器，与 docker ps -a 对齐）
func (c *DockerCollector) listContainers() ([]dockerContainerEntry, error) {
	var entries []dockerContainerEntry
	if err := c.getJSON("/containers/json", &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// getContainerStats GET /containers/{id}/stats?stream=false：单次统计快照
// （stream=false 即 one-shot：返回单份 JSON 后关闭连接）
func (c *DockerCollector) getContainerStats(id string) (dockerContainerStats, error) {
	var stats dockerContainerStats
	// PathEscape 防御性转义：id 来自 API 响应（十六进制），正常无需转义
	path := "/containers/" + url.PathEscape(id) + "/stats?stream=false"
	if err := c.getJSON(path, &stats); err != nil {
		return dockerContainerStats{}, err
	}
	return stats, nil
}

// getJSON 通用 GET：连接错误 / 超时直接透出（调用方降级）；非 200 视为
// 不可用（403 = socket 无权限等）；JSON 解码失败同样透出
func (c *DockerCollector) getJSON(path string, out any) error {
	resp, err := c.client.Get(c.baseURL + path)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Docker API %s 返回 %s", path, resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("Docker API %s 响应解析失败：%w", path, err)
	}
	return nil
}
