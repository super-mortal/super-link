// 内存 / Swap 采集器（口径：PRD docs/prd/server.md §5.3「内存 / Swap」；
// 对照 beszel agent/memory.go 与 agent/system.go calculateHostMemoryUsage）
//
// 数据源 /proc/meminfo（单位 kB，换算字节）：
//   - Used = MemTotal − MemAvailable：PRD §5.3 明确的 gopsutil Used 口径
//     （近似 Total − Available）。MemAvailable 已扣除不可回收页，故 Used
//     含 shmem；仅在异常（Available > Total）时饱和减法兜底为 0；
//   - buff/cache = Cached + SReclaimable + Buffers − Shmem：beszel
//     calculateHostMemoryUsage 口径（gopsutil 的 Cached 已含 SReclaimable；
//     shmem 计入 Cached 但不可回收，扣除避免虚高）；
//   - Swap used = SwapTotal − SwapFree。
//
// 跨平台取舍同 cpu.go：不写构建标签，非 Linux 运行期降级为全 0 + 日志。

package main

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// MemoryStats 内存与 Swap 用量（字节）
type MemoryStats struct {
	Total     uint64
	Used      uint64
	Cached    uint64
	SwapTotal uint64
	SwapUsed  uint64
}

// parseMemInfo 解析 /proc/meminfo（"Key:  <value> kB" 行）为字节数。
// 非数字行（个别内核字段无单位）跳过；meminfo 约定单位为 kB。
func parseMemInfo(content string) map[string]uint64 {
	m := make(map[string]uint64)
	for _, line := range strings.Split(content, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		fields := strings.Fields(strings.TrimSpace(value))
		if len(fields) == 0 {
			continue
		}
		kb, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		m[strings.TrimSpace(key)] = kb * 1024
	}
	return m
}

// memoryStatsFrom 由 meminfo 派生指标（口径集中在此，便于测试）
func memoryStatsFrom(m map[string]uint64) MemoryStats {
	total := m["MemTotal"]
	cached := m["Cached"] + m["SReclaimable"] + m["Buffers"]
	return MemoryStats{
		Total: total,
		// gopsutil Used 口径：Total − Available（含 shmem，PRD §5.3）。
		// MemAvailable 自内核 3.14（2014）起存在，被监控机不可能缺该字段；
		// 缺失时 Available=0、Used=Total，Hub 侧另有 mem_used ≤ mem_total
		// 截断兜底（AgentReportController::parseMetrics）
		Used:      saturatingSub(total, m["MemAvailable"]),
		Cached:    saturatingSub(cached, m["Shmem"]),
		SwapTotal: m["SwapTotal"],
		SwapUsed:  saturatingSub(m["SwapTotal"], m["SwapFree"]),
	}
}

// collectMemory 采集内存 / Swap（读取失败返回全 0 + 日志）
func collectMemory() MemoryStats {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		slog.Warn("内存采集失败，本次报 0", "error", err)
		return MemoryStats{}
	}
	return memoryStatsFrom(parseMemInfo(string(data)))
}

// saturatingSub 逐个扣除，任一被减数大于当前值时结果饱和为 0（防 uint64
// 下溢回绕；beszel agent/system.go 同款工具函数）
func saturatingSub(value uint64, subtrahends ...uint64) uint64 {
	for _, s := range subtrahends {
		if s > value {
			return 0
		}
		value -= s
	}
	return value
}
