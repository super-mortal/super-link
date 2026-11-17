// 开机时长采集器（口径：PRD docs/prd/server.md §5.3「开机时长」）
//
// 数据源 /proc/uptime 第一列（开机以来秒数，带小数；第二列是空闲秒数，与
// Hub 口径无关）。截断取整：Hub server_metrics.uptime 为 INTEGER 列。
// 跨平台取舍同 cpu.go：非 Linux 运行期降级为 0 + 日志。

package main

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// parseUptime 解析 /proc/uptime 第一列为整秒（向下截断）
func parseUptime(content string) (uint64, error) {
	fields := strings.Fields(content)
	if len(fields) == 0 {
		return 0, fmt.Errorf("/proc/uptime 内容为空")
	}
	seconds, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, fmt.Errorf("解析 /proc/uptime 失败：%w", err)
	}
	if seconds <= 0 {
		return 0, nil
	}
	return uint64(seconds), nil
}

// collectUptime 采集开机时长（读取 / 解析失败返回 0 + 日志）
func collectUptime() uint64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		slog.Warn("开机时长采集失败，本次报 0", "error", err)
		return 0
	}
	seconds, err := parseUptime(string(data))
	if err != nil {
		slog.Warn("开机时长解析失败，本次报 0", "error", err)
		return 0
	}
	return seconds
}
