// link-agent —— super-link 服务器监控 Agent（PRD：docs/prd/server.md §5.2 / 决策 D2 / D11）
//
// 被监控 Linux 机器上的常驻守护进程：Go 静态单二进制、零第三方依赖，由 systemd
// （link-agent.service）托管，开机自启、崩溃自动重启。agent 启动后主动外连 Hub
// 并保持长连接（PHP + Apache 约束下以长轮询实现该语义），按 Hub 下发的采集
// 指令回传本机指标快照。
//
// 本文件是入口与运行框架：配置加载、日志、信号处理（优雅退出）、指数退避重连
// 框架与长轮询连接闭环（connectOnce / collectAndReport）。协议类型定义与
// NDJSON 行读取在 protocol.go，采集器由 task17 / task18 交付。
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// version agent 版本号：随 super-link 主版本发布（决策 D12），CI 构建时经
// -ldflags 注入，例如：
//
//	go build -ldflags "-X main.version=v0.0.6" -o link-agent-linux-amd64 .
//
// 未注入时（本地 go build / go run）为 dev。Hub 详情页展示该版本，落后于
// Hub 版本时提示升级（PRD §5.5 / D12）。
var version = "dev"

func main() {
	// 标准库 slog 输出到 stderr：systemd journal 采集（journalctl -u
	// link-agent 可见），与 dev-spec「日志格式」对 agent 的约定一致
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	cfg, err := LoadConfig(defaultConfigPath)
	if err != nil {
		// 必填配置缺失或文件不可读：明确退出并留下中文错误信息，便于
		// journalctl 定位；systemd 的 Restart=always 会按 RestartSec 重启
		logger.Error("配置加载失败，link-agent 退出", "error", err)
		os.Exit(1)
	}

	a := &agent{
		cfg:       cfg,
		logger:    logger,
		client:    newHTTPClient(),
		backoff:   &Backoff{},
		collector: NewCollector(),
	}

	// SIGTERM（systemd stop / restart）与 SIGINT（前台 Ctrl+C）统一转为
	// context 取消，实现优雅退出：取消后在途 HTTP 请求立即中断、连接循环
	// 返回，main 等其结束后以退出码 0 退出（PRD §5.2；dev-spec「优雅退出」）
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	logger.Info("link-agent 启动",
		"version", version,
		"hub", cfg.HubURL,
		"config", defaultConfigPath,
	)

	a.run(ctx)

	logger.Info("link-agent 已退出")
}

// agent link-agent 运行时：配置、日志、共享 HTTP 客户端、退避器与采集器。
// run / connectOnce 构成连接循环（协议见 protocol.go 与 connectOnce 注释），
// collect 指令的处理入口是 collectAndReport（task17 / task18 采集 + task7 协议）。
type agent struct {
	cfg     Config
	logger  *slog.Logger
	client  *http.Client
	backoff *Backoff
	// collector 全量采集器：启动时构造一个实例，之后每个 collect 指令调一次
	// CollectAll（CPU / 网络自第二次采样起才是真实值，见 snapshot.go）
	collector *Collector
}

// HTTP 传输层超时参数：配合「客户端不设总超时」的设计（见 newHTTPClient）
const (
	// dialTimeout 建连（拨号）超时：Hub 不可达时快速失败走退避，不在建连
	// 阶段挂死
	dialTimeout = 10 * time.Second
	// tlsHandshakeTimeout TLS 握手超时（Hub 为 https 时）
	tlsHandshakeTimeout = 10 * time.Second
	// tcpKeepAlive TCP keepalive 探测间隔：长轮询连接的对端静默消失（不吐
	// 数据也不关连接）时，由内核探活最终发现，不至于无限期挂起
	tcpKeepAlive = 30 * time.Second
)

// newHTTPClient 构造共享 HTTP 客户端
//
// 为何不设 Client.Timeout（总超时）：长轮询单次持有 50s 级（Hub 上限 50s，
// 见 AgentConnectController::HOLD_SECONDS），总超时要么小于持有上限而误杀
// 健康连接，要么大到失去意义；连接的取消一律走请求级 context——connectOnce
// 绑定 run 的 ctx（SIGTERM 取消时在途请求立即中断，兑现优雅退出），回传
// 快照等短请求由调用方用 context.WithTimeout(cfg.RequestTimeout) 单独收紧。
// 拨号与 TLS 握手单独设超时（DialTimeout / TLSHandshakeTimeout），只覆盖
// 「建立连接」阶段，不碰建立后的长轮询读取。
func newHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   dialTimeout,
				KeepAlive: tcpKeepAlive,
			}).DialContext,
			TLSHandshakeTimeout: tlsHandshakeTimeout,
		},
	}
}

// errAgentStopped 连接循环的内部语义错误：不应再重连（Token 失效 401）。
// connectOnce / collectAndReport 对 401 返回该错误，run 据此停止循环并记录。
var errAgentStopped = errors.New("认证失败：Agent Token 无效或服务器不存在，停止重连")

// errSuperseded 连接被后续连接挤占（Hub 结束行 reason=superseded）：按指数
// 退避重连，避免新旧两个 agent 互相挤占的热循环（PRD §5.2）。语义上仍是
// 「可重试错误」，run 的退避框架统一处理，单独定义是为了日志可读。
var errSuperseded = errors.New("连接已被新的 agent 连接挤占，退避后重连")

// run 连接循环（协议细节见 connectOnce 与 protocol.go），退出语义：
//
//	正常到期（Hub 结束行 action=reconnect） → 立即重连，不退避；
//	被挤占（结束行 reason=superseded）      → 退避后重连，防新旧 agent 热循环；
//	网络错误 / 5xx                           → 指数退避后重连；
//	401（Token 失效）                        → 停止重连并记录（dev-spec 约定）；
//	403（服务器已暂停）                      → 保持守护、退避重试，用户恢复后自然接入；
//	ctx 取消（SIGTERM / SIGINT）             → 立即返回，main 随后退出。
func (a *agent) run(ctx context.Context) {
	for {
		// 退出信号优先：取消后不再发起新连接
		if ctx.Err() != nil {
			return
		}

		err := a.connectOnce(ctx)

		if ctx.Err() != nil {
			// 优雅退出路径：在途连接已随 ctx 取消中断，错误类型不再关心
			return
		}

		if errors.Is(err, errAgentStopped) {
			// Token 失效：修复路径是用户在 Hub 重置 Token 后重跑安装脚本
			// （重装即换新 Token），agent 自身重试没有意义，停止循环
			a.logger.Error("连接被 Hub 拒绝，link-agent 停止重连", "error", err)
			return
		}

		if err != nil {
			wait := a.backoff.Next()
			a.logger.Warn("连接失败，退避后重连",
				"error", err,
				"backoff", wait.String(),
			)
			// 退避等待同样可被退出信号打断
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			continue
		}

		// 连接正常结束（长轮询到期）：重置退避立即重连，不引入额外延迟
		a.backoff.Reset()
	}
}

// connectOnce 建立一次到 Hub 的长轮询连接并维持到其结束
//
// 协议约定见 controllers/AgentConnectController.php 文件头注释（task6 交付），
// 实现时严格对齐，禁止自行增删字段：
//   - 请求：GET {HubURL}/api/agent/connect，凭据只走请求头 X-Agent-Token；
//     用 http.NewRequestWithContext 绑定 run 的 ctx（优雅退出）；
//   - 响应：application/x-ndjson 按行读取（bufio.Scanner，保活空行跳过，
//     见 protocol.go）：
//     {"cmd":"collect"}               → 采集全量快照并经 POST /api/agent/report 回传（task17/18/7）；
//     {"ok":true,"action":"reconnect"} → 正常到期，返回 nil（run 立即重连、不退避）；
//     {"ok":true,"action":"reconnect","reason":"superseded"} → 被新连接挤占，返回 errSuperseded（run 退避重连）；
//   - 非 200：401 → 返回 errAgentStopped；403（服务器已暂停）→ 返回可重试错误；
//     网络错误 / 5xx → 包装原错误返回，交由 run 的退避框架处理。
func (a *agent) connectOnce(ctx context.Context) error {
	req, err := newAgentRequest(ctx, http.MethodGet, a.cfg.HubURL+connectPath, a.cfg.AgentToken, nil)
	if err != nil {
		return fmt.Errorf("构造 connect 请求失败：%w", err)
	}

	resp, err := a.client.Do(req)
	if err != nil {
		// ctx 取消（SIGTERM）同样走到这里：run 优先判 ctx.Err()，按优雅退出处理
		return fmt.Errorf("连接 Hub 失败：%w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// 200：进入 ndjson 指令流（保活空行 / 采集指令 / 结束行）
	case http.StatusUnauthorized:
		// 401：Token 无效或服务器不存在。停止重连的安全理由：服务端对这两种
		// 情况返回逐字节一致的响应（Utils\AgentAuth 拉平，防枚举），agent
		// 无法也无需区分；继续重试只会形成无限 401 循环，既打不到有效数据
		// 又可能在日志里刷屏，修复路径是用户在 Hub 重置 Token 后重跑安装
		// 脚本（重装即换新 Token）。Token 是高价值凭据（PRD §5.6 / D6），
		// 对认证失败保持「fail closed」是基本纪律。
		return errAgentStopped
	case http.StatusForbidden:
		// 403：服务器已暂停监控（paused=1）。保持守护、按退避重试，用户恢复后
		// 自然接入；暂停期间 Hub 不做离线判定（PRD §5.1），此处无需特殊处理
		return errors.New("服务器已暂停监控（Hub 返回 403），退避后重试")
	default:
		return fmt.Errorf("Hub 返回异常状态码 %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	for {
		event, err := readStreamEvent(scanner)
		if errors.Is(err, io.EOF) {
			// 流干净结束但没收过结束行：Hub 应在释放连接前发结束行，走到这里
			// 说明连接被异常掐断（反代超时 / worker 被杀）。按可重试错误处理，
			// 走退避后重连
			return errors.New("指令流意外结束（未收到 Hub 结束行）")
		}
		if err != nil {
			// 网络中断 / ctx 取消：包装返回，run 的退避框架处理（ctx 取消时
			// run 优先判 ctx.Err()，按优雅退出返回）
			return err
		}

		switch event {
		case eventCollect:
			if err := a.collectAndReport(ctx); err != nil {
				if errors.Is(err, errAgentStopped) {
					// 回传时才发现 Token 失效（连接存续期间被重置）：与
					// connect 401 同语义，向上传递停止重连
					return err
				}
				// 其余回传失败（4xx 丢本轮 / 5xx 下周期重传 / 网络抖动，见
				// collectAndReport 注释）不中断连接：Hub 下个采集周期会重新
				// 下发，记日志即可
				a.logger.Warn("快照回传失败，等待下个采集指令", "error", err)
			}
		case eventReconnect:
			// 正常到期（长轮询语义）：立即重连，不退避
			return nil
		case eventSuperseded:
			return errSuperseded
		}
	}
}

// collectAndReport 执行一次全量采集并经 POST /api/agent/report 回传
//
// 快照字段白名单见 controllers/AgentReportController.php（唯一事实源，
// task18 已逐字段对齐）；响应信封 {"ok":true} / {"ok":false,"message"}。
// 失败语义（按 report 控制器文件头注释）：
//   - 401：与 connect 同一认证分支，返回 errAgentStopped（停止重连）；
//   - 400 / 500 / 信封 ok:false / 网络错误：丢弃本轮，记日志，下个采集周期
//     重传——连接本身不断（Hub 会重新下发 collect）。
func (a *agent) collectAndReport(ctx context.Context) error {
	body, err := json.Marshal(a.collector.CollectAll())
	if err != nil {
		return fmt.Errorf("序列化快照失败：%w", err)
	}

	// 回传是短请求：在 ctx 之下单独收紧超时（RequestTimeout 默认 30s），
	// 绝不影响长轮询连接本身（客户端不设总超时，见 newHTTPClient）
	reqCtx, cancel := context.WithTimeout(ctx, a.cfg.RequestTimeout)
	defer cancel()

	req, err := newAgentRequest(reqCtx, http.MethodPost, a.cfg.HubURL+reportPath, a.cfg.AgentToken, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("构造 report 请求失败：%w", err)
	}

	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("回传快照失败：%w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized:
		// 401：连接建立后 Token 才失效（用户重置）的场景，与 connect 的 401
		// 同一分支（Utils\AgentAuth 拉平），停止重连
		return errAgentStopped
	case http.StatusOK:
		ack, err := readReportAck(resp.Body)
		if err != nil {
			return err
		}
		if !ack.Ok {
			return fmt.Errorf("Hub 未接收快照：%s", ack.Message)
		}
		return nil
	default:
		// 非 200：4xx（包体超限 / 字段越界）丢本轮、5xx（落库失败）下周期
		// 重传。限量读一点响应体用于日志（可能是反代错误页），不做解析
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxAckBytes))
		return fmt.Errorf("Hub 拒绝回传（HTTP %d）：%s", resp.StatusCode, truncateForLog(raw))
	}
}
