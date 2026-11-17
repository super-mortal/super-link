package main

import (
	"errors"
	"testing"
)

func TestParseCPUStatLine(t *testing.T) {
	// 聚合行：user nice system idle iowait irq softirq steal guest guest_nice
	got, ok := parseCPUStatLine("cpu  100 200 300 400 500 600 700 800 900 1000")
	if !ok {
		t.Fatal("聚合行应解析成功")
	}
	if got.user != 100 || got.nice != 200 || got.system != 300 || got.idle != 400 ||
		got.iowait != 500 || got.irq != 600 || got.softirq != 700 || got.steal != 800 {
		t.Fatalf("前 8 项解析不符：%+v", got)
	}
	// total 剔除 guest(900) / guest_nice(1000)：100+200+300+400+500+600+700+800
	if got.total() != 3600 {
		t.Fatalf("total 应为 3600（剔除 guest/guest_nice），实际 %d", got.total())
	}
	// busy = total − idle − iowait = 3600 − 400 − 500
	if got.busy() != 2700 {
		t.Fatalf("busy 应为 2700，实际 %d", got.busy())
	}

	// 每核行、非 cpu 行、字段不足的行都应被拒绝
	if _, ok := parseCPUStatLine("cpu0 100 200 300 400 500"); ok {
		t.Fatal("cpu0 每核行不应被当作聚合行")
	}
	if _, ok := parseCPUStatLine("intr 12345 0 0 0"); ok {
		t.Fatal("intr 行不应解析成功")
	}
	if _, ok := parseCPUStatLine("cpu 100 200 300"); ok {
		t.Fatal("字段不足（少于 user..idle）应拒绝")
	}

	// 尾部字段缺失（老内核无 irq/steal）时按 0 解析成功
	short, ok := parseCPUStatLine("cpu 10 20 30 40 50")
	if !ok || short.total() != 150 || short.busy() != 60 {
		t.Fatalf("短行应解析成功且按缺省 0 处理，实际 ok=%v %+v", ok, short)
	}
}

func TestCPUUsagePercent(t *testing.T) {
	// prev：total=1000，busy=200（user+system 忙，idle 闲）
	prev := cpuTimes{user: 100, system: 100, idle: 800}

	// 增量全忙：total +100、busy +100 → 100%
	cur := cpuTimes{user: 200, system: 100, idle: 800}
	if got := cpuUsagePercent(prev, cur); got != 100 {
		t.Fatalf("全忙增量应为 100%%，实际 %v", got)
	}

	// 一半忙一半闲：system +50、idle +50 → busy 增量 50 / total 增量 100 → 50%
	cur = cpuTimes{user: 100, system: 150, idle: 850}
	if got := cpuUsagePercent(prev, cur); got != 50 {
		t.Fatalf("半忙增量应为 50%%，实际 %v", got)
	}

	// iowait 计入空闲：增量全落在 idle + iowait → busy 增量 0 → 0%
	cur = cpuTimes{user: 100, system: 100, idle: 850, iowait: 50}
	if got := cpuUsagePercent(prev, cur); got != 0 {
		t.Fatalf("iowait 增量应算空闲（0%%），实际 %v", got)
	}

	// 计数器重置（total 回退）→ 0
	reset := cpuTimes{user: 10, system: 10, idle: 80}
	if got := cpuUsagePercent(prev, reset); got != 0 {
		t.Fatalf("计数器重置应报 0，实际 %v", got)
	}
}

func TestCPUSamplerFirstSampleAndReset(t *testing.T) {
	// 首采样建基线报 0；随后按增量算；第 4 次计数器重置报 0 并重建基线；
	// 第 5 次在新基线上恢复正常
	samples := []cpuTimes{
		{user: 100, system: 100, idle: 800},
		{user: 200, system: 100, idle: 800}, // +100 全忙 → 100%
		{user: 300, system: 100, idle: 800}, // +100 全忙 → 100%
		{user: 10, system: 10, idle: 80},    // total 1200→100 重置 → 0
		{user: 110, system: 10, idle: 80},   // 新基线上 +100 全忙 → 100%
	}
	i := 0
	s := &CPUSampler{readTimes: func() (cpuTimes, error) {
		cur := samples[i]
		i++
		return cur, nil
	}}
	want := []float64{0, 100, 100, 0, 100}
	for n, w := range want {
		if got := s.Sample(); got != w {
			t.Fatalf("第 %d 次采样应为 %v，实际 %v", n+1, w, got)
		}
	}
}

func TestCPUSamplerReadErrorDegrades(t *testing.T) {
	s := &CPUSampler{readTimes: func() (cpuTimes, error) {
		return cpuTimes{}, errors.New("读取失败")
	}}
	if got := s.Sample(); got != 0 {
		t.Fatalf("读取失败应报 0，实际 %v", got)
	}
}
