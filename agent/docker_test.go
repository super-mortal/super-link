package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// dockerStatsJSON 构造 /containers/{id}/stats 响应体：cpu / system 为
// cpu_stats 累计值；memUsage / inactiveFile / cache / memLimit 为内存口径；
// networks 为 networks 对象的原始 JSON（可含多网卡或传 "" 表示缺省）
func dockerStatsJSON(cpu, system, memUsage, inactiveFile, cache, memLimit uint64, networks string) string {
	if networks == "" {
		networks = "{}"
	}
	return fmt.Sprintf(`{
		"cpu_stats":{"cpu_usage":{"total_usage":%d},"system_cpu_usage":%d},
		"memory_stats":{"usage":%d,"stats":{"inactive_file":%d,"cache":%d},"limit":%d},
		"networks":%s
	}`, cpu, system, memUsage, inactiveFile, cache, memLimit, networks)
}

// newTestDockerCollector 构造指向 httptest server 的采集器：
// /containers/json 恒返回 listJSON；/containers/{id}/stats 按
// statsSeq[id] 依次返回各帧（超出序列后重复最后一帧，便于多轮采集测试）。
// 返回采集器与时钟指针：测试里 *clock = clock.Add(...) 控制采集间隔。
func newTestDockerCollector(t *testing.T, listJSON string, statsSeq map[string][]string) (*DockerCollector, *time.Time) {
	t.Helper()
	calls := make(map[string]int)
	mux := http.NewServeMux()
	mux.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(listJSON))
	})
	mux.HandleFunc("/containers/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/containers/"), "/stats")
		seq := statsSeq[id]
		idx := calls[id]
		calls[id]++
		if idx >= len(seq) {
			idx = len(seq) - 1
		}
		if idx < 0 {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(seq[idx]))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	clock := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	c := newDockerCollectorWithClient(srv.Client(), srv.URL, "")
	c.now = func() time.Time { return clock }
	return c, &clock
}

func TestDockerCollectCPURate(t *testing.T) {
	// 单容器 c1，5 分钟间隔（决策 D4 采集周期），5 帧 stats：
	// 首帧建基线报 0；随后按「容器 cpu 增量 ÷ system 增量 × 100」计算
	c, clock := newTestDockerCollector(t,
		`[{"Id":"c1","Names":["/web"],"State":"running"}]`,
		map[string][]string{"c1": {
			// 帧1：基线（cpu=1000ns、system=4000ns）
			dockerStatsJSON(1000, 4000, 0, 0, 0, 0, ""),
			// 帧2：cpu +500、system +2000 → 25%
			// （不乘核数：4 核机器上乘 4 会得 100%，PRD §5.3 明令禁止）
			dockerStatsJSON(1500, 6000, 0, 0, 0, 0, ""),
			// 帧3：system 无增量 → 除零保护报 0
			dockerStatsJSON(1600, 6000, 0, 0, 0, 0, ""),
			// 帧4：cpu 计数器重置（1600→100）→ 报 0 并重建基线
			dockerStatsJSON(100, 6100, 0, 0, 0, 0, ""),
			// 帧5：新基线上 cpu +200、system +500 → 40%
			dockerStatsJSON(300, 6600, 0, 0, 0, 0, ""),
		}},
	)

	want := []float64{0, 25, 0, 0, 40}
	for i, w := range want {
		if i > 0 {
			*clock = clock.Add(5 * time.Minute)
		}
		got := c.Collect()
		if len(got) != 1 {
			t.Fatalf("第 %d 轮应采集到 1 个容器，实际 %d", i+1, len(got))
		}
		if got[0].Cpu != w {
			t.Fatalf("第 %d 轮 CPU 应为 %v%%，实际 %v%%", i+1, w, got[0].Cpu)
		}
	}
}

func TestDockerCollectMemoryAndNetwork(t *testing.T) {
	c, clock := newTestDockerCollector(t,
		`[{"Id":"c1","Names":["/web"],"State":"running"}]`,
		map[string][]string{"c1": {
			// 帧1：usage=100MiB、inactive_file=20MiB → mem_used=80MiB；
			// 网络 eth0+eth1 合计累计 rx=3000/tx=600（首轮建基线，速率 0）
			dockerStatsJSON(1000, 4000, 100<<20, 20<<20, 0, 512<<20,
				`{"eth0":{"rx_bytes":1000,"tx_bytes":500},"eth1":{"rx_bytes":2000,"tx_bytes":100}}`),
			// 帧2（5 分钟后）：inactive_file 缺失 → 回退 cache=30MiB → 70MiB；
			// 网络合计 rx=6500/tx=2200 → 增量 3500/1600 ÷ 300s → 12/5 B/s
			dockerStatsJSON(1500, 6000, 100<<20, 0, 30<<20, 512<<20,
				`{"eth0":{"rx_bytes":4000,"tx_bytes":2000},"eth1":{"rx_bytes":2500,"tx_bytes":200}}`),
		}},
	)

	first := c.Collect()
	if first[0].MemUsed != 80<<20 || first[0].MemLimit != 512<<20 {
		t.Fatalf("内存口径应为 used=80MiB limit=512MiB，实际 %+v", first[0])
	}
	if first[0].NetRx != 0 || first[0].NetTx != 0 {
		t.Fatalf("首轮应建基线、速率报 0，实际 rx=%d tx=%d", first[0].NetRx, first[0].NetTx)
	}

	*clock = clock.Add(5 * time.Minute)
	second := c.Collect()
	if second[0].MemUsed != 70<<20 {
		t.Fatalf("inactive_file 缺失应回退 cache：mem_used 应为 70MiB，实际 %d", second[0].MemUsed)
	}
	// 3500B/300s≈11.67→12；1600B/300s≈5.33→5（四舍五入取整，同 network.go）
	if second[0].NetRx != 12 || second[0].NetTx != 5 {
		t.Fatalf("网络速率应为 rx=12 tx=5 B/s，实际 rx=%d tx=%d", second[0].NetRx, second[0].NetTx)
	}
}

func TestDockerCollectNetworkCounterReset(t *testing.T) {
	// 容器重启后计数器清零：cur < prev 时以 cur 为增量（network.go
	// counterDelta 同款）——90000B ÷ 300s = 300 B/s
	c, clock := newTestDockerCollector(t,
		`[{"Id":"c1","Names":["/web"],"State":"running"}]`,
		map[string][]string{"c1": {
			dockerStatsJSON(1000, 4000, 0, 0, 0, 0, `{"eth0":{"rx_bytes":100000,"tx_bytes":100000}}`),
			dockerStatsJSON(1500, 6000, 0, 0, 0, 0, `{"eth0":{"rx_bytes":90000,"tx_bytes":60000}}`),
		}},
	)
	c.Collect()
	*clock = clock.Add(5 * time.Minute)
	got := c.Collect()
	if got[0].NetRx != 300 || got[0].NetTx != 200 {
		t.Fatalf("计数器重置后应按当前累计值计增量（rx=300 tx=200），实际 rx=%d tx=%d", got[0].NetRx, got[0].NetTx)
	}
}

func TestContainerMemoryUsed(t *testing.T) {
	// usage − inactive_file
	if got := containerMemoryUsed(dockerMemoryStats{
		Usage: 100 << 20,
		Stats: dockerMemoryDetail{InactiveFile: 20 << 20},
		Limit: 512 << 20,
	}); got != 80<<20 {
		t.Fatalf("应为 usage−inactive_file=80MiB，实际 %d", got)
	}
	// inactive_file 为 0（cgroup v1 老内核不报）→ 回退 cache
	if got := containerMemoryUsed(dockerMemoryStats{
		Usage: 100 << 20,
		Stats: dockerMemoryDetail{InactiveFile: 0, Cache: 30 << 20},
	}); got != 70<<20 {
		t.Fatalf("inactive_file 缺失应回退 cache，实际 %d", got)
	}
	// usage ≤ 可回收量（采集竞态 / 口径异常）→ 截断 0
	if got := containerMemoryUsed(dockerMemoryStats{
		Usage: 10 << 20,
		Stats: dockerMemoryDetail{InactiveFile: 20 << 20},
	}); got != 0 {
		t.Fatalf("usage ≤ 可回收量应截断为 0，实际 %d", got)
	}
}

func TestDockerAPIFailureDegrades(t *testing.T) {
	// 列表端点 500 → 空列表
	srv500 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv500.Close()
	c := newDockerCollectorWithClient(srv500.Client(), srv500.URL, "")
	c.now = time.Now
	if got := c.Collect(); len(got) != 0 {
		t.Fatalf("API 500 应降级为空列表，实际 %+v", got)
	}

	// 列表端点 403（socket 无权限）→ 空列表
	srv403 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv403.Close()
	c = newDockerCollectorWithClient(srv403.Client(), srv403.URL, "")
	if got := c.Collect(); len(got) != 0 {
		t.Fatalf("API 403 应降级为空列表，实际 %+v", got)
	}

	// 连接被拒（server 已关闭，模拟 socket 不存在 / daemon 未运行）→ 空列表
	srvClosed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := srvClosed.URL
	srvClosed.Close()
	c = newDockerCollectorWithClient(srvClosed.Client(), closedURL, defaultDockerSocket)
	if got := c.Collect(); len(got) != 0 {
		t.Fatalf("连接失败应降级为空列表，实际 %+v", got)
	}
}

func TestDockerStatsFailureKeepsContainer(t *testing.T) {
	// 列表成功但单容器 stats 失败：容器仍上报（名称 / 状态可见），指标记 0
	mux := http.NewServeMux()
	mux.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"Id":"c1","Names":["/web"],"State":"running"}]`))
	})
	mux.HandleFunc("/containers/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := newDockerCollectorWithClient(srv.Client(), srv.URL, "")
	got := c.Collect()
	if len(got) != 1 {
		t.Fatalf("stats 失败时容器仍应上报，实际 %d 个", len(got))
	}
	if got[0].Container != "web" || got[0].State != "running" || got[0].Cpu != 0 || got[0].MemUsed != 0 {
		t.Fatalf("stats 失败应指标记 0 且保留名称状态，实际 %+v", got[0])
	}
}

func TestContainerDisplayName(t *testing.T) {
	// Names 带前导 "/"，需剥离
	if got := containerDisplayName(dockerContainerEntry{Id: "abcdef1234567890", Names: []string{"/web"}}); got != "web" {
		t.Fatalf("应剥掉前导斜杠得 web，实际 %q", got)
	}
	// Names 缺失 → 退回 12 位短 id
	if got := containerDisplayName(dockerContainerEntry{Id: "abcdef1234567890"}); got != "abcdef123456" {
		t.Fatalf("Names 缺失应退回短 id，实际 %q", got)
	}
	// Names 仅剩斜杠（畸形）→ 同样退回短 id，避免空名被 Hub 拒整包
	if got := containerDisplayName(dockerContainerEntry{Id: "abcdef1234567890", Names: []string{"/"}}); got != "abcdef123456" {
		t.Fatalf("空名应退回短 id，实际 %q", got)
	}
}

func TestNormalizeContainerState(t *testing.T) {
	cases := []struct {
		state  string
		status string
		want   string
	}{
		{"running", "Up 3 hours", "running"},
		{"exited", "Exited (0) 2 days ago", "exited"},
		{"RUNNING", "", "running"}, // 大小写归一（Hub 侧同样 strtolower）
		{"", "Up 3 hours (healthy)", "running"},
		{"", "Restarting (1) 5 seconds ago", "restarting"},
		{"", "Removal In Progress", "removing"},
		{"", "Paused", "paused"},
		{"", "Created", "created"},
		{"", "Dead", "dead"},
		{"", "Exited (137) 2 minutes ago", "exited"},
		{"", "", "exited"},      // 无法识别 → 回落 exited（Hub 白名单封闭枚举）
		{"bogus", "", "exited"}, // 白名单外 → 回落 exited
	}
	for _, tc := range cases {
		got := normalizeContainerState(dockerContainerEntry{State: tc.state, Status: tc.status})
		if got != tc.want {
			t.Fatalf("state=%q status=%q 应为 %q，实际 %q", tc.state, tc.status, tc.want, got)
		}
	}
	// 回落值必须落在 Hub 白名单内（否则拒整包）
	for state := range dockerStateWhitelist {
		if !dockerStateWhitelist[state] {
			t.Fatalf("白名单自身不一致：%q", state)
		}
	}
}

func TestDockerContainerJSONTags(t *testing.T) {
	// 与 AgentReportController::parseDocker 白名单（container / cpu /
	// mem_used / mem_limit / net_rx / net_tx / state）逐字段一致
	b, err := json.Marshal(DockerContainer{
		Container: "web", Cpu: 12.5, MemUsed: 1, MemLimit: 2, NetRx: 3, NetTx: 4, State: "running",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"container":"web","cpu":12.5,"mem_used":1,"mem_limit":2,"net_rx":3,"net_tx":4,"state":"running"}`
	if string(b) != want {
		t.Fatalf("JSON 字段应与 Hub 白名单一致\n期望 %s\n实际 %s", want, b)
	}
}

func TestDockerPruneBaselines(t *testing.T) {
	c := NewDockerCollector()
	c.lastCPU["gone"] = dockerCPUCounter{}
	c.lastNet["gone"] = dockerNetCounter{}
	c.lastAt["gone"] = time.Now()
	c.lastCPU["keep"] = dockerCPUCounter{}
	c.lastNet["keep"] = dockerNetCounter{}
	c.lastAt["keep"] = time.Now()

	c.pruneBaselines(map[string]bool{"keep": true})

	if _, ok := c.lastCPU["gone"]; ok {
		t.Fatal("消失容器的 CPU 基线应被清理")
	}
	if _, ok := c.lastNet["gone"]; ok {
		t.Fatal("消失容器的网络基线应被清理")
	}
	if _, ok := c.lastAt["gone"]; ok {
		t.Fatal("消失容器的时间基线应被清理")
	}
	if _, ok := c.lastCPU["keep"]; !ok {
		t.Fatal("存活容器的基线应保留")
	}
}

func TestDockerCollectEmptyList(t *testing.T) {
	// 没装 Docker / daemon 未运行：API 正常返回空列表（与失败降级同效）
	c, _ := newTestDockerCollector(t, `[]`, nil)
	if got := c.Collect(); len(got) != 0 {
		t.Fatalf("空列表应返回空，实际 %+v", got)
	}
}
