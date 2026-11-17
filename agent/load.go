// 负载采集器（口径：PRD docs/prd/server.md §5.3「负载」）
//
// 数据源 /proc/loadavg 前三列（1 / 5 / 15 分钟平均可运行进程数），形如
// "0.15 0.10 0.05 1/500 12345"。跨平台取舍同 cpu.go：非 Linux 运行期
// 降级为 0 + 日志。

package main

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// LoadStats 系统负载（1 / 5 / 15 分钟）
type LoadStats struct {
	Load1  float64
	Load5  float64
	Load15 float64
}

// parseLoadAvg 解析 /proc/loadavg：取前三列为负载值，后两列
// （运行数/总进程数、最后创建 PID）与 Hub 口径无关，不解析。
func parseLoadAvg(content string) (LoadStats, error) {
	fields := strings.Fields(content)
	if len(fields) < 3 {
		return LoadStats{}, fmt.Errorf("/proc/loadavg 字段不足（至少 3 列，实际 %d）", len(fields))
	}
	loads := make([]float64, 3)
	for i := range loads {
		v, err := strconv.ParseFloat(fields[i], 64)
		if err != nil {
			return LoadStats{}, fmt.Errorf("解析 /proc/loadavg 第 %d 列失败：%w", i+1, err)
		}
		loads[i] = v
	}
	return LoadStats{Load1: loads[0], Load5: loads[1], Load15: loads[2]}, nil
}

// collectLoad 采集负载（读取 / 解析失败返回 0 + 日志）
func collectLoad() LoadStats {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		slog.Warn("负载采集失败，本次报 0", "error", err)
		return LoadStats{}
	}
	stats, err := parseLoadAvg(string(data))
	if err != nil {
		slog.Warn("负载解析失败，本次报 0", "error", err)
		return LoadStats{}
	}
	return stats
}
