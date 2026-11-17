// IP 采集（口径：PRD docs/prd/server.md §5.3「系统信息」；前端列表 / 详情
// 系统信息行展示，见 §5.5）
//
// 数据源选 /proc/net/fib_trie 而非 hostname -I（exec），理由：
//   - 零 exec：不依赖 hostname 命令是否存在（精简发行版 / minimal 容器可能
//     没装），也不付进程创建成本——与「极度轻量的探针」定位一致（PRD §1.2）；
//   - /proc/net/fib_trie 是内核 IPv4 路由表（FIB）的文本转储，任何 Linux
//     都有，且只读无副作用。
//
// 失败降级：文件不可读 / 无默认路由 / 无可用本地地址一律返回空串并记日志
// （Hub 侧 ip 缺省不更新，保留原值，不影响其余指标回传——与各采集器单点
// 失败降级同一约定，见 snapshot.go CollectAll 注释）。
//
// 跨平台：不写 //go:build linux——/proc 经 os.ReadFile 读取，Windows 开发
// 机上编译 / vet / 单测均可过（单测走 fixture 纯函数），运行期数据源缺失
// 时按上面的降级策略返回空串；agent 按决策 D8 只部署在 Linux。

package main

import (
	"errors"
	"log/slog"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

// collectIP 采集默认路由对应的本机 IPv4 地址；失败降级为空串（见文件头注释）
func collectIP() string {
	data, err := os.ReadFile("/proc/net/fib_trie")
	if err != nil {
		slog.Warn("读取 /proc/net/fib_trie 失败，ip 留空", "error", err)
		return ""
	}
	ip, err := parseFibTrieDefaultIP(string(data))
	if err != nil {
		slog.Warn("解析 /proc/net/fib_trie 失败，ip 留空", "error", err)
		return ""
	}
	return ip
}

// parseFibTrieDefaultIP 从 /proc/net/fib_trie 内容解析「默认路由对应的本机 IP」，
// 无法判定时返回错误（调用方降级为空串）。
//
// 文件格式（内核 net/ipv4/fib_trie.c 的 fib_trie_seq_show 输出，v5.4 与
// 现行主线一致；缩进只反映 trie 深度，解析不依赖它）：
//
//	Main:                        <- 表头（Local: / Main: / Id N:）
//	  +-- 0.0.0.0/0 3 0 4         <- 内部节点（trie tnode）
//	     |-- 0.0.0.0              <- 叶子节点（路由前缀）
//	        /0 universe UNICAST   <- 路由条目：/<前缀长度> <scope> <type>
//	     |-- 192.168.1.100
//	        /32 host LOCAL        <- 本机地址（Local 表每个本机 IP 一条）
//
// 判定规则：
//  1. Main 表必须存在默认路由（前缀长度 0 的条目，即 0.0.0.0/0）——没有默认
//     路由的机器（隔离网络 / 仅内网）谈不上「出口 IP」，按失败降级；
//  2. 本机地址取 Local 表中 /32 host LOCAL 条目的叶子地址，剔除 127.0.0.0/8；
//  3. 多地址时取 trie 序（按地址数值升序）的首个非回环地址。
//
// 已知局限（内核协议所限，非实现偷懒）：fib_trie 只打印路由的前缀长度 /
// scope / type，不打印默认路由的网关、出口网卡与 prefsrc，因此多网卡机器
// 无法从该文件判定默认路由的真实出口，只能取数值最小的非回环本地地址（与
// hostname -I | awk '{print $1}' 同款的「取一个代表地址」语义）；单网卡
// （个人自托管的绝大多数场景）即精确值。ip 仅作展示，不参与任何逻辑判断。
func parseFibTrieDefaultIP(content string) (string, error) {
	var (
		section    string // 当前表分区：Main / Local / Id N
		leaf       string // 当前叶子节点（路由前缀）的地址
		hasDefault bool   // Main 表是否存在默认路由（/0 条目）
		localIP    string // 选中的本机 IP（首个非回环本地地址）
	)

	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		switch {
		case isFibTableHeader(line):
			// 表头：切换分区，叶子归属重置（跨表不串味）
			section = strings.TrimSuffix(line, ":")
			leaf = ""

		case strings.HasPrefix(line, "/"):
			// 路由条目：/<前缀长度> <scope> <type>[ tos=N]
			fields := strings.Fields(line)
			if len(fields) < 3 {
				continue
			}
			plen, err := strconv.Atoi(strings.TrimPrefix(fields[0], "/"))
			if err != nil {
				continue
			}
			switch {
			case section == "Main" && plen == 0:
				// 0.0.0.0/0：默认路由表项
				hasDefault = true
			case section == "Local" && plen == 32 && fields[1] == "host" && fields[2] == "LOCAL":
				// 本机地址条目。Local 表按 trie 序（数值升序）输出，首个
				// 非回环本地地址即所选；localIP 只赋值一次
				if localIP == "" && isUsableIPv4(leaf) {
					localIP = leaf
				}
			}

		case strings.Contains(line, "|--"):
			// 叶子节点行：|-- <地址>（后续路由条目都挂在它下面）
			fields := strings.Fields(line)
			for i, f := range fields {
				if f == "|--" && i+1 < len(fields) {
					leaf = fields[i+1]
					break
				}
			}

		default:
			// "+--" 内部节点行与无法识别的行：不影响判定，跳过
		}
	}

	if !hasDefault {
		return "", errors.New("Main 表中没有默认路由（0.0.0.0/0）")
	}
	if localIP == "" {
		return "", errors.New("Local 表中没有可用的本机地址（/32 host LOCAL 且非回环）")
	}
	return localIP, nil
}

// isFibTableHeader 判断是否为表头行（fib_table_print 输出：Local: / Main: / Id N:）
func isFibTableHeader(line string) bool {
	if line == "Main:" || line == "Local:" {
		return true
	}
	return strings.HasPrefix(line, "Id ") && strings.HasSuffix(line, ":")
}

// isUsableIPv4 判断字符串是否为可用的 IPv4 地址字面量（非回环）。
// 解析失败按不可用处理：宁可降级为空串，也不把脏数据当 IP 回传。
func isUsableIPv4(s string) bool {
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return false
	}
	return addr.Is4() && !addr.IsLoopback()
}
