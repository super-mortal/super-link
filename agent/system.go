// 系统信息采集器（口径：PRD docs/prd/server.md §5.3「系统信息」）
//
// 数据源：发行版取 /etc/os-release 的 PRETTY_NAME；内核版本取
// /proc/sys/kernel/osrelease（即 uname -r 的数据源，避免多一次进程创建，
// 也不用 syscall.Uname——Linux 专属符号会破坏 Windows 交叉编译与单测）；
// CPU 核数取 runtime.NumCPU（与 nproc 语义一致：遵循进程 CPU 亲和性，
// 容器内即容器可见核数——PRD §9.2 beszel 在容器内按 cpuset 修正，affinity
// 口径与之等价且零解析；数 /proc/cpuinfo 会忽略亲和性且需按 physical id /
// core id 去重，复杂度不值）；架构取 runtime.GOARCH（与 uname -m 的
// x86_64 / aarch64 等价，且与 CI 产物名 link-agent-linux-amd64 对齐）。
// 跨平台取舍同 cpu.go：非 Linux 运行期各项独立降级。

package main

import (
	"log/slog"
	"os"
	"runtime"
	"strings"
)

// SystemInfo 系统信息
//
// JSON 字段名与 AgentReportController::parseSystemInfo 白名单对齐：
// os → servers.os_name、kernel → servers.kernel、cores → servers.cpu_cores。
// arch 是白名单外字段：Hub 忽略（向前兼容），随快照回传便于排查双架构
// 分发（决策 D12）下的二进制错装。
type SystemInfo struct {
	Os     string `json:"os"`
	Kernel string `json:"kernel"`
	Cores  int    `json:"cores"`
	Arch   string `json:"arch"`
}

// parseOSRelease 从 /etc/os-release 内容取发行版名：优先 PRETTY_NAME，
// 回退 NAME，再回退 "Linux"（两种都缺失时给通用名，避免 servers.os_name
// 永远空白）
func parseOSRelease(content string) string {
	var pretty, name string
	for _, line := range strings.Split(content, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "PRETTY_NAME":
			pretty = unquoteOSValue(value)
		case "NAME":
			name = unquoteOSValue(value)
		}
	}
	if pretty != "" {
		return pretty
	}
	if name != "" {
		return name
	}
	return "Linux"
}

// unquoteOSValue 剥除 os-release 值的成对引号（shell 语法允许 'x' / "x"）
func unquoteOSValue(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && (s[0] == '"' || s[0] == '\'') && s[len(s)-1] == s[0] {
		return s[1 : len(s)-1]
	}
	return s
}

// collectSystemInfo 采集系统信息；各项独立降级（读不到留空 / 0 + 日志）
func collectSystemInfo() SystemInfo {
	info := SystemInfo{
		Cores: runtime.NumCPU(),
		Arch:  runtime.GOARCH,
	}
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		info.Os = parseOSRelease(string(data))
	} else {
		// agent 按决策 D8 只跑在 Linux，发行版未知时给通用名而非留空
		info.Os = "Linux"
		slog.Warn("读取 /etc/os-release 失败，发行版回退为通用名", "error", err)
	}
	if data, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		info.Kernel = strings.TrimSpace(string(data))
	} else {
		slog.Warn("读取内核版本失败，kernel 留空", "error", err)
	}
	return info
}
