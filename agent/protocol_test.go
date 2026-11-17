package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// newTestAgent 构造指向 httptest server 的 agent（协议测试共享装配）。
// 采集器用真实 NewCollector：各采集器在数据源缺失时降级为零值 / 空列表
// （见 snapshot.go CollectAll 注释），测试断言只依赖跨平台稳定的字段
// （cores / agent_version / JSON 键集合）。
func newTestAgent(t *testing.T, hubURL, token string) *agent {
	t.Helper()
	return &agent{
		cfg: Config{
			HubURL:          hubURL,
			AgentToken:      token,
			CollectInterval: 300 * time.Second,
			ConnectTimeout:  70 * time.Second,
			RequestTimeout:  30 * time.Second,
		},
		logger:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		client:    newHTTPClient(),
		backoff:   &Backoff{},
		collector: NewCollector(),
	}
}

// hubRecorder 记录 mock Hub 收到的请求（agent 的 connect 与 report 由
// httptest 的不同 goroutine 处理，读写加锁）
type hubRecorder struct {
	mu          sync.Mutex
	connectTok  string
	reportTok   string
	reportCT    string
	reportCalls int
	reportBody  map[string]any
}

func (h *hubRecorder) snapshot() (connectTok, reportTok, reportCT string, calls int, body map[string]any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.connectTok, h.reportTok, h.reportCT, h.reportCalls, h.reportBody
}

func TestClassifyStreamLine(t *testing.T) {
	cases := []struct {
		name string
		line string
		want streamEvent
	}{
		{"采集指令", `{"cmd":"collect"}`, eventCollect},
		{"保活空行", ``, eventSkip},
		{"保活空白行", "   ", eventSkip},
		{"正常到期结束行", `{"ok":true,"action":"reconnect"}`, eventReconnect},
		{"被挤占结束行", `{"ok":true,"action":"reconnect","reason":"superseded"}`, eventSuperseded},
		{"未知 JSON 行", `{"cmd":"unknown"}`, eventSkip},
		{"非 JSON 行", `hello`, eventSkip},
		{"ok:false 行", `{"ok":false,"message":"x"}`, eventSkip},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := classifyStreamLine([]byte(c.line)); got != c.want {
				t.Fatalf("分类结果不符：got %v, want %v", got, c.want)
			}
		})
	}
}

// TestConnectOnceCollectReportLoop 全链路闭环：connect 建连（Token 头）→
// 采集指令 → collectAndReport 回传（Token 头 + JSON Content-Type + 白名单
// 字段）→ 保活空行跳过 → 结束行正常到期（返回 nil，run 立即重连）
func TestConnectOnceCollectReportLoop(t *testing.T) {
	rec := &hubRecorder{}
	mux := http.NewServeMux()
	mux.HandleFunc(connectPath, func(w http.ResponseWriter, r *http.Request) {
		rec.mu.Lock()
		rec.connectTok = r.Header.Get(tokenHeader)
		rec.mu.Unlock()

		w.Header().Set("Content-Type", "application/x-ndjson")
		flusher := w.(http.Flusher)
		// 采集指令
		_, _ = w.Write([]byte(`{"cmd":"collect"}` + "\n"))
		flusher.Flush()
		// 保活空行（应被跳过，不触发回传以外的动作）
		_, _ = w.Write([]byte("\n"))
		flusher.Flush()
		// 结束行：正常到期
		_, _ = w.Write([]byte(`{"ok":true,"action":"reconnect"}` + "\n"))
		flusher.Flush()
	})
	mux.HandleFunc(reportPath, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rec.mu.Lock()
		rec.reportCalls++
		rec.reportTok = r.Header.Get(tokenHeader)
		rec.reportCT = r.Header.Get("Content-Type")
		_ = json.Unmarshal(raw, &rec.reportBody)
		rec.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	if err := a.connectOnce(context.Background()); err != nil {
		t.Fatalf("connectOnce 应按「正常到期」返回 nil，实际 %v", err)
	}

	connectTok, reportTok, reportCT, calls, body := rec.snapshot()
	if connectTok != "slk_test_token" {
		t.Fatalf("connect 请求头 %s 不符：%q", tokenHeader, connectTok)
	}
	if calls != 1 {
		t.Fatalf("采集指令应触发恰好一次回传，实际 %d 次", calls)
	}
	if reportTok != "slk_test_token" {
		t.Fatalf("report 请求头 %s 不符：%q", tokenHeader, reportTok)
	}
	if reportCT != "application/json" {
		t.Fatalf("report Content-Type 应为 application/json，实际 %q", reportCT)
	}

	// 回传快照的键必须与 AgentReportController 字段白名单逐字段对齐
	//（arch 为白名单外字段，随包发送供排查双架构分发，Hub 忽略）
	wantKeys := []string{
		"cpu", "mem_used", "mem_total", "mem_cached", "swap_used", "swap_total",
		"load1", "load5", "load15", "net_rx", "net_tx", "uptime",
		"disks", "docker",
		"os", "kernel", "cores", "ip", "agent_version", "arch",
	}
	for _, key := range wantKeys {
		if _, ok := body[key]; !ok {
			t.Fatalf("回传快照缺少字段 %s：%v", key, body)
		}
	}
	// 跨平台稳定的非空校验：核数来自 runtime.NumCPU，版本号未注入时为 dev
	if cores, ok := body["cores"].(float64); !ok || cores <= 0 {
		t.Fatalf("cores 应为正数，实际 %v", body["cores"])
	}
	if body["agent_version"] != version {
		t.Fatalf("agent_version 应为 %q，实际 %v", version, body["agent_version"])
	}
}

// TestConnectOnceReconnectImmediately 结束行 action=reconnect：正常到期，
// 返回 nil（run 据此立即重连、不退避）
func TestConnectOnceReconnectImmediately(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc(connectPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"action":"reconnect"}` + "\n"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	if err := a.connectOnce(context.Background()); err != nil {
		t.Fatalf("正常到期应返回 nil，实际 %v", err)
	}
}

// TestConnectOnceSuperseded 结束行 reason=superseded：被新连接挤占，返回
// errSuperseded（run 据此退避重连，防新旧 agent 热循环）
func TestConnectOnceSuperseded(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc(connectPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"action":"reconnect","reason":"superseded"}` + "\n"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	err := a.connectOnce(context.Background())
	if !errors.Is(err, errSuperseded) {
		t.Fatalf("被挤占应返回 errSuperseded，实际 %v", err)
	}
}

// TestConnectOnceUnauthorizedStops 401：Token 失效，返回 errAgentStopped
func TestConnectOnceUnauthorizedStops(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_bad_token")
	err := a.connectOnce(context.Background())
	if !errors.Is(err, errAgentStopped) {
		t.Fatalf("401 应返回 errAgentStopped，实际 %v", err)
	}
}

// TestRunStopsOnUnauthorized 401 后 run 停止重连：不进入退避等待，立即返回
func TestRunStopsOnUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_bad_token")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		a.run(ctx)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("401 后 run 应立即停止重连（无退避等待），实际仍在循环")
	}
}

// TestConnectOnceForbiddenRetryable 403：服务器已暂停，返回可重试错误
// （不是 errAgentStopped，run 走退避重试路径）
func TestConnectOnceForbiddenRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	err := a.connectOnce(context.Background())
	if err == nil {
		t.Fatal("403 应返回错误")
	}
	if errors.Is(err, errAgentStopped) {
		t.Fatalf("403（暂停）不应停止重连，实际 %v", err)
	}
}

// TestRunRetriesAfterForbidden 403 后 run 保持守护并按退避重试
func TestRunRetriesAfterForbidden(t *testing.T) {
	var attempts int
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		a.run(ctx)
		close(done)
	}()
	// 首次立即尝试 + 首次退避（1s ± 抖动）后第二次：3s 窗口内至少两次
	time.Sleep(3 * time.Second)
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if attempts < 2 {
		t.Fatalf("403 后应按退避重试（3s 窗口内至少 2 次尝试），实际 %d 次", attempts)
	}
}

// TestConnectOnceSkipsKeepAliveLines 保活空行被跳过：无采集指令则不回传，
// 读到结束行正常返回
func TestConnectOnceSkipsKeepAliveLines(t *testing.T) {
	rec := &hubRecorder{}
	mux := http.NewServeMux()
	mux.HandleFunc(connectPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		flusher := w.(http.Flusher)
		// Hub 每秒写一个保活空行（含仅空白字符的行），随后到期
		for i := 0; i < 3; i++ {
			_, _ = w.Write([]byte("\n"))
			flusher.Flush()
		}
		_, _ = w.Write([]byte("   \n"))
		_, _ = w.Write([]byte(`{"ok":true,"action":"reconnect"}` + "\n"))
		flusher.Flush()
	})
	mux.HandleFunc(reportPath, func(w http.ResponseWriter, r *http.Request) {
		rec.mu.Lock()
		rec.reportCalls++
		rec.mu.Unlock()
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	if err := a.connectOnce(context.Background()); err != nil {
		t.Fatalf("跳过保活行后应正常到期返回 nil，实际 %v", err)
	}
	_, _, _, calls, _ := rec.snapshot()
	if calls != 0 {
		t.Fatalf("没有采集指令时不应回传，实际 %d 次", calls)
	}
}

// TestConnectOnceReportEnvelopeNotOk report 信封 ok:false：记日志不崩，
// 连接不断（后续结束行照常处理，返回 nil）
func TestConnectOnceReportEnvelopeNotOk(t *testing.T) {
	rec := &hubRecorder{}
	mux := http.NewServeMux()
	mux.HandleFunc(connectPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		flusher := w.(http.Flusher)
		_, _ = w.Write([]byte(`{"cmd":"collect"}` + "\n"))
		flusher.Flush()
		_, _ = w.Write([]byte(`{"ok":true,"action":"reconnect"}` + "\n"))
		flusher.Flush()
	})
	mux.HandleFunc(reportPath, func(w http.ResponseWriter, r *http.Request) {
		rec.mu.Lock()
		rec.reportCalls++
		rec.mu.Unlock()
		// 400：包体超限 / 字段越界（report 控制器 reject 分支）
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"message":"回传包超过大小上限"}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	if err := a.connectOnce(context.Background()); err != nil {
		t.Fatalf("回传被拒不应中断连接，应读到结束行返回 nil，实际 %v", err)
	}
	_, _, _, calls, _ := rec.snapshot()
	if calls != 1 {
		t.Fatalf("采集指令应触发一次回传（被拒也记数），实际 %d 次", calls)
	}
}

// TestConnectOnceContextCancel ctx 取消（SIGTERM 语义）：在途长轮询读取
// 立即中断，connectOnce 返回错误（run 按优雅退出处理）
func TestConnectOnceContextCancel(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc(connectPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		flusher := w.(http.Flusher)
		// 先下发一条采集指令（回传走完），随后把持连接直到客户端断开
		_, _ = w.Write([]byte(`{"cmd":"collect"}` + "\n"))
		flusher.Flush()
		<-r.Context().Done()
	})
	mux.HandleFunc(reportPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- a.connectOnce(ctx)
	}()

	// 等采集指令被处理（回传已完成）后取消，模拟 SIGTERM
	time.Sleep(200 * time.Millisecond)
	cancel()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("ctx 取消后 connectOnce 应返回错误")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("ctx 取消后 connectOnce 未及时返回（优雅退出失效）")
	}
}

// TestConnectOnceStreamUnexpectedEnd 流干净结束但没收过结束行：按可重试
// 错误返回（run 走退避）
func TestConnectOnceStreamUnexpectedEnd(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc(connectPath, func(w http.ResponseWriter, r *http.Request) {
		// 只写保活行后直接结束（模拟反代掐断）
		_, _ = w.Write([]byte("\n"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	a := newTestAgent(t, srv.URL, "slk_test_token")
	err := a.connectOnce(context.Background())
	if err == nil || errors.Is(err, errAgentStopped) {
		t.Fatalf("指令流意外结束应返回可重试错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "指令流意外结束") {
		t.Fatalf("错误信息应说明原因，实际 %v", err)
	}
}

// TestNewAgentRequest 请求构造：Token 头 + JSON Content-Type + ctx 绑定
func TestNewAgentRequest(t *testing.T) {
	ctx := context.Background()
	req, err := newAgentRequest(ctx, http.MethodGet, "http://hub/api/agent/connect", "slk_x", nil)
	if err != nil {
		t.Fatalf("构造 GET 请求失败：%v", err)
	}
	if req.Header.Get(tokenHeader) != "slk_x" {
		t.Fatalf("Token 头缺失：%v", req.Header)
	}
	if req.Header.Get("Content-Type") != "" {
		t.Fatalf("GET 不应带 Content-Type，实际 %q", req.Header.Get("Content-Type"))
	}

	req, err = newAgentRequest(ctx, http.MethodPost, "http://hub/api/agent/report", "slk_x", strings.NewReader(`{"cpu":0}`))
	if err != nil {
		t.Fatalf("构造 POST 请求失败：%v", err)
	}
	if req.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("POST 应带 application/json，实际 %q", req.Header.Get("Content-Type"))
	}
}

// TestTruncateForLog 错误消息里的响应片段截断
func TestTruncateForLog(t *testing.T) {
	if got := truncateForLog([]byte("  short  ")); got != "short" {
		t.Fatalf("短片段应原样 trim 返回，实际 %q", got)
	}
	long := strings.Repeat("x", 500)
	if got := truncateForLog([]byte(long)); len(got) != 200+len("…") {
		t.Fatalf("长片段应截断到 200 字符 + 省略号，实际 %d", len(got))
	}
}
