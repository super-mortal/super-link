// CPU 采集器（口径：PRD docs/prd/server.md §5.3「CPU 使用率」；对照 beszel
// agent/cpu.go 的 getAllBusy / calculateBusy）
//
// 数据源 /proc/stat 首行（cpu 聚合行，单位 jiffies、开机以来累计），两次采样
// 取增量：total 剔除 guest / guest_nice（二者已分别计入 user / nice，不剔除
// 会双算——beszel getAllBusy 的 Linux 分支同款处理），busy = total − idle −
// iowait（CPU 等 I/O 时没有计算负载，算空闲），使用率 = busy 增量 ÷ total 增量。
// 语义：首采样报 0（只建立基线，PRD §5.3 明确要求）；计数器重置（本次 total ≤
// 上次 total，内核计数器跳变 / 热插拔）重建基线并报 0；结果截断到 0–100。
//
// 跨平台取舍：不写 //go:build linux——/proc 经 os.ReadFile 读取，Windows 上
// 编译、go vet、单测全部可过（纯函数测试不碰真实 /proc），运行期数据源缺失
// 时按降级策略报 0 + 日志；agent 按决策 D8 只部署在 Linux，无需平台分叉。

package main

import (
	"errors"
	"log/slog"
	"math"
	"os"
	"strconv"
	"strings"
)

// cpuTimes /proc/stat 聚合行的计数器（jiffies，开机以来累计）。
// 只存 total 口径需要的 8 项：guest / guest_nice 按口径从 total 剔除，无需解析。
type cpuTimes struct {
	user    uint64
	nice    uint64
	system  uint64
	idle    uint64
	iowait  uint64
	irq     uint64
	softirq uint64
	steal   uint64
}

// parseCPUStatLine 解析 /proc/stat 的一行；仅接受聚合行（首字段恰为 "cpu"，
// 不匹配 cpu0 等每核行）。字段顺序 user nice system idle iowait irq softirq
// steal [guest [guest_nice]]：尾部项按内核版本可能缺失，缺省 0；user..idle
// 是 2.6 以后内核的底线，不足即拒绝该行。
func parseCPUStatLine(line string) (cpuTimes, bool) {
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuTimes{}, false
	}
	vals := make([]uint64, 8)
	for i := 1; i <= 8 && i < len(fields); i++ {
		v, err := strconv.ParseUint(fields[i], 10, 64)
		if err != nil {
			return cpuTimes{}, false
		}
		vals[i-1] = v
	}
	return cpuTimes{
		user:    vals[0],
		nice:    vals[1],
		system:  vals[2],
		idle:    vals[3],
		iowait:  vals[4],
		irq:     vals[5],
		softirq: vals[6],
		steal:   vals[7],
	}, true
}

// total 总 CPU 时间：剔除 guest / guest_nice（PRD §5.3，beszel 同款）
func (t cpuTimes) total() uint64 {
	return t.user + t.nice + t.system + t.idle + t.iowait + t.irq + t.softirq + t.steal
}

// busy 繁忙时间 = total − idle − iowait（iowait 计空闲，PRD §5.3）
func (t cpuTimes) busy() uint64 {
	return t.total() - t.idle - t.iowait
}

// cpuUsagePercent 两次采样间的 CPU 使用率（0–100，百分比）
//
// 无有效增量时返回 0：首采样（无上次基线）或计数器重置 / 回绕（cur.total ≤
// prev.total）。busy 单独跳变（理论罕见）时增量按 0，避免负数百分比。
func cpuUsagePercent(prev, cur cpuTimes) float64 {
	prevTotal, curTotal := prev.total(), cur.total()
	if curTotal <= prevTotal {
		return 0
	}
	busyDelta := uint64(0)
	if cur.busy() > prev.busy() {
		busyDelta = cur.busy() - prev.busy()
	}
	pct := float64(busyDelta) / float64(curTotal-prevTotal) * 100
	return math.Min(100, math.Max(0, pct))
}

// readProcCPUTimes 读 /proc/stat 并取聚合行
func readProcCPUTimes() (cpuTimes, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuTimes{}, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if t, ok := parseCPUStatLine(line); ok {
			return t, nil
		}
	}
	return cpuTimes{}, errors.New("/proc/stat 中未找到 cpu 聚合行")
}

// CPUSampler CPU 使用率采样器（两次采样增量）。
// 非并发安全：采集由 Hub 的 collect 指令串行触发，单 goroutine 使用。
type CPUSampler struct {
	// readTimes 数据源注入点：默认读 /proc/stat，测试替换为 fixture 序列
	readTimes func() (cpuTimes, error)
	last      cpuTimes
	hasLast   bool
}

// NewCPUSampler 构造采样器：首采样报 0 并建立基线（PRD §5.3）
func NewCPUSampler() *CPUSampler {
	return &CPUSampler{readTimes: readProcCPUTimes}
}

// Sample 采一次样，返回距上次成功采样的使用率（0–100）
//
// 降级（各采集器统一约定，见 snapshot.go）：读取 / 解析失败返回 0 并记日志，
// 基线不动——下次成功样本按实际经过时间计算，口径不失真，单点失败不影响
// 快照其余字段。
func (s *CPUSampler) Sample() float64 {
	cur, err := s.readTimes()
	if err != nil {
		slog.Warn("CPU 采集失败，本次报 0", "error", err)
		return 0
	}
	if !s.hasLast {
		s.hasLast = true
		s.last = cur
		return 0
	}
	usage := cpuUsagePercent(s.last, cur)
	// 先算后更新基线：计数器重置时本次报 0，同时基线换成新值，下次采样恢复正常
	s.last = cur
	return usage
}
