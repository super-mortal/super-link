package main

import "testing"

const memInfoFixture = `MemTotal:       16384000 kB
MemFree:         1000000 kB
MemAvailable:    8000000 kB
Buffers:          500000 kB
Cached:          3000000 kB
SwapCached:        10000 kB
Shmem:            200000 kB
SReclaimable:     300000 kB
SwapTotal:       2097152 kB
SwapFree:        1048576 kB
`

func TestParseMemInfo(t *testing.T) {
	m := parseMemInfo(memInfoFixture)
	if m["MemTotal"] != 16384000*1024 {
		t.Fatalf("MemTotal 应换算为字节，实际 %d", m["MemTotal"])
	}
	if m["MemAvailable"] != 8000000*1024 {
		t.Fatalf("MemAvailable 应换算为字节，实际 %d", m["MemAvailable"])
	}
}

func TestMemoryStatsFrom(t *testing.T) {
	stats := memoryStatsFrom(parseMemInfo(memInfoFixture))

	// Used = Total − Available（gopsutil Used 口径，含 shmem）
	if stats.Total != 16384000*1024 {
		t.Fatalf("Total 错误：%d", stats.Total)
	}
	if want := uint64((16384000 - 8000000) * 1024); stats.Used != want {
		t.Fatalf("Used 应为 Total−Available=%d，实际 %d", want, stats.Used)
	}
	// buff/cache = Cached + SReclaimable + Buffers − Shmem
	if want := uint64((3000000 + 300000 + 500000 - 200000) * 1024); stats.Cached != want {
		t.Fatalf("Cached 应为 %d，实际 %d", want, stats.Cached)
	}
	// Swap
	if want := uint64(2097152 * 1024); stats.SwapTotal != want {
		t.Fatalf("SwapTotal 应为 %d，实际 %d", want, stats.SwapTotal)
	}
	if want := uint64((2097152 - 1048576) * 1024); stats.SwapUsed != want {
		t.Fatalf("SwapUsed 应为 %d，实际 %d", want, stats.SwapUsed)
	}
}

func TestMemoryStatsFromEmpty(t *testing.T) {
	// /proc/meminfo 读取失败降级：全 0，不 panic
	if got := memoryStatsFrom(nil); got != (MemoryStats{}) {
		t.Fatalf("空输入应得全 0，实际 %+v", got)
	}
}

func TestSaturatingSub(t *testing.T) {
	if got := saturatingSub(10, 3, 4); got != 3 {
		t.Fatalf("10-3-4 应为 3，实际 %d", got)
	}
	// 任一被减数大于当前值 → 饱和 0，不回绕
	if got := saturatingSub(5, 6); got != 0 {
		t.Fatalf("5-6 应饱和为 0，实际 %d", got)
	}
	if got := saturatingSub(5, 3, 6); got != 0 {
		t.Fatalf("5-3-6 应饱和为 0，实际 %d", got)
	}
}
