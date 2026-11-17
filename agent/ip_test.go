package main

import (
	"net/netip"
	"testing"
)

// fibTrieMultiFixture 按真实 /proc/net/fib_trie 转储组织（内核
// fib_trie_seq_show 输出格式，v5.4 与现行主线一致）：
// Main 表有默认路由与两个子网（各带本地 /32 host LOCAL 条目——main 表也会
// 出现本地路由副本，解析只认 Local 表）；Local 表有回环与两个本机地址。
// 多地址场景：按 trie 序（数值升序）取首个非回环地址 10.8.0.1。
const fibTrieMultiFixture = `Main:
  +-- 0.0.0.0/0 3 0 4
     +-- 0.0.0.0/4 2 0 2
        |-- 0.0.0.0
           /0 universe UNICAST
        +-- 10.8.0.0/13 2 0 2
           +-- 10.8.0.0/24 2 0 2
              +-- 10.8.0.0/31 1 0 0
                 |-- 10.8.0.0
                    /32 link BROADCAST
                    /24 link UNICAST
                 |-- 10.8.0.1
                    /32 host LOCAL
              |-- 10.8.0.255
                 /32 link BROADCAST
     +-- 127.0.0.0/8 2 0 2
        +-- 127.0.0.0/31 1 0 0
           |-- 127.0.0.0
              /32 link BROADCAST
              /8 host LOCAL
           |-- 127.0.0.1
              /32 host LOCAL
        |-- 127.255.255.255
           /32 link BROADCAST
     +-- 192.168.191.0/24 2 0 2
        |-- 192.168.191.0
           /32 link BROADCAST
           /24 link UNICAST
        +-- 192.168.191.224/27 2 0 2
           |-- 192.168.191.238
              /32 host LOCAL
           |-- 192.168.191.255
              /32 link BROADCAST
Local:
  +-- 0.0.0.0/0 0 1 1
     +-- 127.0.0.0/8 2 0 2
        |-- 127.0.0.0
           /32 link BROADCAST
           /8 host LOCAL
        |-- 127.0.0.1
           /32 host LOCAL
     |-- 10.8.0.1
        /32 host LOCAL
     |-- 192.168.191.238
        /32 host LOCAL
`

// fibTrieSingleFixture 单网卡常见形态：eth0 = 192.168.1.100，默认路由经它出口
const fibTrieSingleFixture = `Main:
  +-- 0.0.0.0/0 0 1 1
     |-- 0.0.0.0
        /0 universe UNICAST
     |-- 127.0.0.0
        /8 host LOCAL
     |-- 192.168.1.0
        /24 link UNICAST
     |-- 192.168.1.100
        /32 host LOCAL
Local:
  +-- 0.0.0.0/0 0 1 1
     |-- 127.0.0.0
        /8 host LOCAL
     |-- 127.0.0.1
        /32 host LOCAL
     |-- 192.168.1.100
        /32 host LOCAL
`

// fibTrieNoDefaultFixture 无默认路由（隔离网络 / 仅内网）：降级
const fibTrieNoDefaultFixture = `Main:
  +-- 0.0.0.0/8 0 1 1
     |-- 10.0.0.0
        /24 link UNICAST
     |-- 10.0.0.5
        /32 host LOCAL
Local:
  +-- 0.0.0.0/0 0 1 1
     |-- 127.0.0.1
        /32 host LOCAL
     |-- 10.0.0.5
        /32 host LOCAL
`

// fibTrieLoopbackOnlyFixture 只有回环地址：有默认路由也没有可用的本机地址
const fibTrieLoopbackOnlyFixture = `Main:
  +-- 0.0.0.0/0 0 1 1
     |-- 0.0.0.0
        /0 universe UNICAST
Local:
  +-- 0.0.0.0/0 0 1 1
     |-- 127.0.0.0
        /8 host LOCAL
     |-- 127.0.0.1
        /32 host LOCAL
`

// fibTrieLinkLocalOnlyFixture 本机地址只有链路本地地址（169.254/16，DHCP
// 失败时的自动配置段）：有默认路由也不可用作展示 IP，按失败降级
const fibTrieLinkLocalOnlyFixture = `Main:
  +-- 0.0.0.0/0 0 1 1
     |-- 0.0.0.0
        /0 universe UNICAST
Local:
  +-- 0.0.0.0/0 0 1 1
     |-- 127.0.0.1
        /32 host LOCAL
     |-- 169.254.1.5
        /32 host LOCAL
     |-- 169.254.169.254
        /32 host LOCAL
`

func TestParseFibTrieDefaultIP(t *testing.T) {
	// 多地址场景：默认路由存在，本地地址有 10.8.0.1 与 192.168.191.238 两个
	// （另有回环）。fib_trie 不输出默认路由的网关 / 出口网卡 / prefsrc，多
	// 网卡时取 trie 序（数值最小）的首个非回环地址——与 hostname -I |
	// awk '{print $1}' 同款「取一个代表地址」语义；单网卡即精确值
	ip, err := parseFibTrieDefaultIP(fibTrieMultiFixture)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if ip != "10.8.0.1" {
		t.Fatalf("应取 trie 序首个非回环本地地址 10.8.0.1，实际 %q", ip)
	}
}

func TestParseFibTrieSingleAddress(t *testing.T) {
	ip, err := parseFibTrieDefaultIP(fibTrieSingleFixture)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if ip != "192.168.1.100" {
		t.Fatalf("单网卡场景应取唯一非回环地址 192.168.1.100，实际 %q", ip)
	}
}

func TestParseFibTrieNoDefaultRoute(t *testing.T) {
	// Main 表没有 /0 条目：没有默认路由谈不上出口 IP，按失败降级
	if _, err := parseFibTrieDefaultIP(fibTrieNoDefaultFixture); err == nil {
		t.Fatal("无默认路由应返回错误（降级空串）")
	}
}

func TestParseFibTrieLoopbackOnly(t *testing.T) {
	// 有默认路由但本地地址只有回环：没有可用的本机地址
	if _, err := parseFibTrieDefaultIP(fibTrieLoopbackOnlyFixture); err == nil {
		t.Fatal("仅回环地址应返回错误（降级空串）")
	}
}

func TestParseFibTrieLinkLocalOnly(t *testing.T) {
	// 有默认路由但本地地址只有链路本地地址（169.254/16）：APIPA 段不作展示 IP
	if _, err := parseFibTrieDefaultIP(fibTrieLinkLocalOnlyFixture); err == nil {
		t.Fatal("仅链路本地地址应返回错误（降级空串）")
	}
}

func TestParseFibTrieGarbage(t *testing.T) {
	for _, content := range []string{"", "   \n\n", "not a fib_trie at all\n", "Main:\n  +-- broken line\n"} {
		if _, err := parseFibTrieDefaultIP(content); err == nil {
			t.Fatalf("脏数据 %q 应返回错误（降级空串）", content)
		}
	}
}

func TestIsUsableIPv4(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"192.168.1.100", true},
		{"10.8.0.1", true},
		{"127.0.0.1", false}, // 回环
		{"127.255.255.254", false},
		{"169.254.1.1", false},     // 链路本地（APIPA）
		{"169.254.169.254", false}, // 链路本地（云元数据地址段）
		{"0.0.0.0", true},          // 非回环 IPv4（实际不会成为 /32 host LOCAL 的叶子）
		{"::1", false},             // IPv6 回环
		{"fe80::1", false},         // IPv6 链路本地
		{"not-an-ip", false},
		{"", false},
	}
	for _, c := range cases {
		if got := isUsableIPv4(c.in); got != c.want {
			t.Fatalf("isUsableIPv4(%q) = %v, want %v", c.in, got, c.want)
		}
	}
	// 与 netip 的口径交叉校验：IsLoopback 覆盖 127/8，IsLinkLocalUnicast 覆盖 169.254/16
	if !netip.MustParseAddr("127.0.0.1").IsLoopback() {
		t.Fatal("netip 口径异常：127.0.0.1 应判回环")
	}
	if !netip.MustParseAddr("169.254.1.1").IsLinkLocalUnicast() {
		t.Fatal("netip 口径异常：169.254.1.1 应判链路本地")
	}
}

// TestCollectIPDegrades collectIP 对真实 /proc/net/fib_trie 的降级行为：
// 文件不存在（Windows 开发机）→ 空串；存在（Linux）→ 空串或合法 IPv4。
// 不因运行平台不同而失败。
func TestCollectIPDegrades(t *testing.T) {
	ip := collectIP()
	if ip == "" {
		// 降级路径（数据源缺失 / 无默认路由 / 无可用地址）：顺带验证空内容
		// 的解析失败与 collectIP 的降级一致
		if _, err := parseFibTrieDefaultIP(""); err == nil {
			t.Fatal("空内容应解析失败")
		}
		return
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		t.Fatalf("collectIP 返回了非法地址 %q：%v", ip, err)
	}
	if !addr.Is4() {
		t.Fatalf("fib_trie 只覆盖 IPv4，实际返回 %q", ip)
	}
	if addr.IsLoopback() {
		t.Fatalf("不应返回回环地址 %q", ip)
	}
}
