package main

import (
	"errors"
	"testing"
	"time"
)

// /proc/net/dev fixture：表头两行 + lo（排除）+ eth0（计入）+ docker0（双零，
// 排除）+ veth1 / br-abc（名前排除）+ tun0（只发不收，仍计入）
const netDevFixture = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 12345678   12345    0    0    0     0          0         0 12345678   12345    0    0    0     0       0          0
  eth0:987654321  987654    0    0    0     0          0         0 123456789  987654    0    0    0     0       0          0
docker0:      0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
 veth1: 100000    1000    0    0    0     0          0         0    50000     500    0    0    0     0       0          0
 br-abc: 200000    2000    0    0    0     0          0         0        0       0    0    0    0     0       0          0
   tun0:       0       0    0    0    0     0          0         0    99999     999    0    0    0     0       0          0
`

func TestParseNetDev(t *testing.T) {
	entries := parseNetDev(netDevFixture)
	byName := make(map[string]nicStat, len(entries))
	for _, e := range entries {
		byName[e.name] = e.nicStat
	}
	// 表头无 ':' 被跳过，共 6 个网卡
	if len(entries) != 6 {
		t.Fatalf("应解析出 6 个网卡，实际 %d", len(entries))
	}
	// 接收/发送字节分别是冒号后第 1、9 列
	if byName["eth0"].rx != 987654321 || byName["eth0"].tx != 123456789 {
		t.Fatalf("eth0 累计值解析错误：%+v", byName["eth0"])
	}
	if byName["tun0"].rx != 0 || byName["tun0"].tx != 99999 {
		t.Fatalf("tun0 累计值解析错误：%+v", byName["tun0"])
	}
}

func TestNicExclusions(t *testing.T) {
	// 默认排除清单：lo、docker*、br-*、veth*、bond*、cali*
	for _, name := range []string{"lo", "docker0", "br-abc", "veth1", "bond0", "cali1234"} {
		if nicAllowed(name) {
			t.Fatalf("%q 应在默认排除清单内", name)
		}
	}
	for _, name := range []string{"eth0", "ens5", "wlan0", "tun0", "enp0s3"} {
		if !nicAllowed(name) {
			t.Fatalf("%q 不应被默认排除", name)
		}
	}
	// 零计数器：收发均为 0 不计入；单方向有流量仍计入
	if nicCounted(netDevEntry{name: "docker0", nicStat: nicStat{}}) {
		t.Fatal("收发双零网卡不应计入")
	}
	if !nicCounted(netDevEntry{name: "tun0", nicStat: nicStat{tx: 1}}) {
		t.Fatal("只发不收的网卡仍应计入")
	}
	if nicCounted(netDevEntry{name: "lo", nicStat: nicStat{rx: 1, tx: 1}}) {
		t.Fatal("lo 有流量也不应计入")
	}
}

func TestBytesPerSecondAndCounterDelta(t *testing.T) {
	if got := bytesPerSecond(100, 3*time.Second); got < 33.3 || got > 33.4 {
		t.Fatalf("100 字节 / 3 秒应约 33.33 B/s，实际 %v", got)
	}
	if got := bytesPerSecond(10, 0); got != 0 {
		t.Fatalf("零间隔应返回 0，实际 %v", got)
	}
	if got := counterDelta(2000, 1000); got != 1000 {
		t.Fatalf("正常增量应为 1000，实际 %d", got)
	}
	// 计数器重置：以当前累计值为增量
	if got := counterDelta(300, 2000); got != 300 {
		t.Fatalf("重置后增量应按当前累计值 300，实际 %d", got)
	}
}

func TestNetworkSamplerRate(t *testing.T) {
	base := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	clock := base
	samples := [][]netDevEntry{
		{
			{name: "eth0", nicStat: nicStat{rx: 1000, tx: 2000}},
			{name: "lo", nicStat: nicStat{rx: 5, tx: 5}},
		},
		{
			// lo 涨幅大但不计入；eth0 +1000 / +2000
			{name: "eth0", nicStat: nicStat{rx: 2000, tx: 4000}},
			{name: "lo", nicStat: nicStat{rx: 900, tx: 900}},
		},
		{
			// 计数器重置：eth0 归零，增量按当前累计值计
			{name: "eth0", nicStat: nicStat{rx: 300, tx: 100}},
		},
	}
	i := 0
	s := &NetworkSampler{
		readDev: func() ([]netDevEntry, error) {
			e := samples[i]
			i++
			return e, nil
		},
		now: func() time.Time { return clock },
	}

	// 首采样建基线报 0
	if got := s.Sample(); got != (NetStats{}) {
		t.Fatalf("首采样应报 0，实际 %+v", got)
	}
	// 2 秒间隔：1000/2000 字节 → 500/1000 B/s
	clock = clock.Add(2 * time.Second)
	if got := s.Sample(); got != (NetStats{Rx: 500, Tx: 1000}) {
		t.Fatalf("速率应为 rx=500 tx=1000，实际 %+v", got)
	}
	// 再 2 秒：计数器重置，增量 300/100 → 150/50 B/s
	clock = clock.Add(2 * time.Second)
	if got := s.Sample(); got != (NetStats{Rx: 150, Tx: 50}) {
		t.Fatalf("计数器重置应按当前累计值计增量，实际 %+v", got)
	}
}

func TestNetworkSamplerReadErrorDegrades(t *testing.T) {
	s := &NetworkSampler{
		readDev: func() ([]netDevEntry, error) { return nil, errors.New("读取失败") },
		now:     time.Now,
	}
	if got := s.Sample(); got != (NetStats{}) {
		t.Fatalf("读取失败应报 0，实际 %+v", got)
	}
}
