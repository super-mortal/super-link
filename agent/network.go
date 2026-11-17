// 网络采集器（口径：PRD docs/prd/server.md §5.3「网络」；对照 beszel
// agent/network.go 的 skipNetworkInterface / NICS 预留）
//
// 数据源 /proc/net/dev 每网卡累计收发字节，两次采样增量 ÷ 实际间隔得速率
// （bytes/s），由 agent 侧算好、Hub 不做换算（PRD §5.3）。排除清单：lo、
// docker*、br-*、veth*、bond*、cali*（回环与容器 / 桥接 / 绑定虚拟网卡，
// 不是本机真实对外流量）与收发累计均为 0 的零计数器网卡。NICS 白 / 黑名单
// 预留 nicMatcher 扩展点（PRD：beszel 同款，后续按需开放）。
// 跨平台取舍同 cpu.go：非 Linux 运行期降级为 0 + 日志。

package main

import (
	"log/slog"
	"math"
	"os"
	"strconv"
	"strings"
	"time"
)

// NetStats 网络吞吐速率（字节/秒）
type NetStats struct {
	Rx uint64
	Tx uint64
}

// nicStat 单网卡累计字节数（/proc/net/dev 的接收 / 发送字节列）
type nicStat struct {
	rx uint64
	tx uint64
}

// netDevEntry /proc/net/dev 一行：网卡名 + 累计值
type netDevEntry struct {
	name string
	nicStat
}

// nicMatcher NICS 白 / 黑名单扩展点（PRD §5.3：beszel 同款，后续按需开放）
//
// 当前恒为 nil：只走默认排除清单。未来实现时（解析 NICS 环境变量）把此
// 变量设为「该网卡是否保留」的判定函数，nicAllowed 会优先咨询它。语义参考
// beszel agent/network.go 的 NicConfig：'-' 前缀为黑名单、否则白名单，
// 支持 '*' 通配符（path.Match）；白名单模式空表 = 全不选，黑名单模式
// 空表 = 全选。
var nicMatcher func(name string) bool

// nicAllowed 网卡名是否通过默认排除清单（beszel skipNetworkInterface 的
// 名前规则；零计数器规则要结合累计值，见 nicCounted）
func nicAllowed(name string) bool {
	if nicMatcher != nil {
		return nicMatcher(name)
	}
	switch {
	case name == "lo",
		strings.HasPrefix(name, "docker"),
		strings.HasPrefix(name, "br-"),
		strings.HasPrefix(name, "veth"),
		strings.HasPrefix(name, "bond"),
		strings.HasPrefix(name, "cali"):
		return false
	}
	return true
}

// nicCounted 该网卡本次是否计入速率：默认排除清单 + 零计数器（收发累计
// 均为 0 的未启用 / 虚拟占位网卡）。beszel 为「任一为 0 即跳过」，更激进；
// 按 PRD「零计数器」字面取双零，单方向有流量的网卡（如只发不收的 tun）
// 仍计入。
func nicCounted(e netDevEntry) bool {
	return nicAllowed(e.name) && (e.rx > 0 || e.tx > 0)
}

// parseNetDev 解析 /proc/net/dev：每行 "name: rx_bytes rx_packets …（8 项）
// tx_bytes tx_packets …（8 项）"，取接收 / 发送字节累计值（第 1、9 项）。
// 前两行表头无 ':'，自然跳过；计数列不足 16 列的行视为异常，跳过。
func parseNetDev(content string) []netDevEntry {
	var entries []netDevEntry
	for _, line := range strings.Split(content, "\n") {
		name, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) < 16 {
			continue
		}
		rx, err1 := strconv.ParseUint(fields[0], 10, 64)
		tx, err2 := strconv.ParseUint(fields[8], 10, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		entries = append(entries, netDevEntry{
			name:    strings.TrimSpace(name),
			nicStat: nicStat{rx: rx, tx: tx},
		})
	}
	return entries
}

// readProcNetDev 读 /proc/net/dev
func readProcNetDev() ([]netDevEntry, error) {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil, err
	}
	return parseNetDev(string(data)), nil
}

// counterDelta 累计计数器增量：回绕 / 重置（cur < prev，如计数器被清零
// 重启）时以 cur 为增量——重置后计数器从 0 开始，cur 即本间隔增量
// （beszel agent/network.go 同款处理）
func counterDelta(cur, prev uint64) uint64 {
	if cur >= prev {
		return cur - prev
	}
	return cur
}

// bytesPerSecond 增量 ÷ 实际经过时间（PRD §5.3：÷ 实际间隔，非固定周期）
func bytesPerSecond(delta uint64, elapsed time.Duration) float64 {
	seconds := elapsed.Seconds()
	if seconds <= 0 {
		return 0
	}
	return float64(delta) / seconds
}

// NetworkSampler 网络速率采样器（两次采样增量）。
// 非并发安全：采集由 Hub 的 collect 指令串行触发，单 goroutine 使用。
type NetworkSampler struct {
	// readDev 数据源注入点：默认读 /proc/net/dev，测试替换为 fixture 序列
	readDev func() ([]netDevEntry, error)
	// now 时钟注入点：测试控制间隔，避免真实 sleep
	now     func() time.Time
	last    map[string]nicStat
	lastAt  time.Time
	hasLast bool
}

// NewNetworkSampler 构造采样器：首采样报 0 并建立基线（与 CPU 同语义）
func NewNetworkSampler() *NetworkSampler {
	return &NetworkSampler{readDev: readProcNetDev, now: time.Now}
}

// Sample 返回距上次成功采样的合计收发速率（字节/秒）
//
// 四舍五入取整：Hub server_metrics.net_rx / net_tx 为 INTEGER 列，与
// beszel 的整数字节/秒口径一致（beszel 用整数除法截断，取整保留更多精度）。
// 基线存全部网卡、不过滤：过滤发生在算增量时，避免网卡在间隔内被重新分类
// （如新建 docker 网桥）时基线丢失。间隔内消失的网卡放弃其最后一段增量
// （无最终计数器可依，个人服务器场景可忽略）。降级同 cpu.go：读取失败
// 返回 0 + 日志，基线不动。
func (s *NetworkSampler) Sample() NetStats {
	cur, err := s.readDev()
	if err != nil {
		slog.Warn("网络采集失败，本次报 0", "error", err)
		return NetStats{}
	}
	now := s.now()
	if !s.hasLast {
		s.hasLast = true
		s.last = nicStatMap(cur)
		s.lastAt = now
		return NetStats{}
	}

	elapsed := now.Sub(s.lastAt)
	var rxDelta, txDelta uint64
	for _, e := range cur {
		if !nicCounted(e) {
			continue
		}
		prev, ok := s.last[e.name]
		if !ok {
			// 本间隔内新出现的网卡：无基线，不计入（下次起正常）
			continue
		}
		rxDelta += counterDelta(e.rx, prev.rx)
		txDelta += counterDelta(e.tx, prev.tx)
	}
	s.last = nicStatMap(cur)
	s.lastAt = now

	if elapsed <= 0 {
		return NetStats{}
	}
	return NetStats{
		Rx: uint64(math.Round(bytesPerSecond(rxDelta, elapsed))),
		Tx: uint64(math.Round(bytesPerSecond(txDelta, elapsed))),
	}
}

// nicStatMap 把本次采样整理为「网卡 → 累计值」，作为下轮基线
func nicStatMap(entries []netDevEntry) map[string]nicStat {
	m := make(map[string]nicStat, len(entries))
	for _, e := range entries {
		m[e.name] = e.nicStat
	}
	return m
}
