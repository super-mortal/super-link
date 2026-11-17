// link-agent —— super-link 服务器监控 Agent（PRD：docs/prd/server.md §5.2 / 决策 D2 / D11）
//
// 被监控 Linux 机器上的常驻守护进程：Go 静态单二进制、零第三方依赖，由 systemd
// （link-agent.service）托管，开机自启、崩溃自动重启。agent 启动后主动外连 Hub
// 并保持长连接（PHP + Apache 约束下以长轮询实现该语义），按 Hub 下发的采集
// 指令回传本机指标快照。
//
// 本文件是入口与运行框架：配置加载、日志、信号处理（优雅退出）与指数退避重连
// 框架。协议细节由 task19 按后端 AgentConnectController 的协议约定填充（见
// connectOnce 注释），采集器由 task17 / task18 填充。
package main

import (
	"context"
	"errors"
	"log/slog"
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
		cfg:     cfg,
		logger:  logger,
		client:  newHTTPClient(cfg),
		backoff: &Backoff{},
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

// agent link-agent 运行时：配置、日志、共享 HTTP 客户端与退避器。
// run / connectOnce 构成连接循环框架，task19 填充协议细节；采集指令的
// 处理入口预留给 task17 / task18。
type agent struct {
	cfg     Config
	logger  *slog.Logger
	client  *http.Client
	backoff *Backoff
}

// newHTTPClient 构造共享 HTTP 客户端
//
// Timeout 取连接超时（所有请求里最长的）作兜底天花板，避免误杀长轮询连接；
// 更短的请求（如回传快照）由调用方用 context.WithTimeout 单独收紧。
// 优雅退出依赖请求级 context：connectOnce 等必须用
// http.NewRequestWithContext(ctx, ...) 绑定 run 的 ctx，SIGTERM 取消时
// 在途请求随之中断，main 等待连接循环返回后退出。
func newHTTPClient(cfg Config) *http.Client {
	return &http.Client{Timeout: cfg.ConnectTimeout}
}

// errAgentStopped 连接循环的内部语义错误：不应再重连（Token 失效 401）。
// task19 在协议实现里对 401 返回该错误，run 据此停止循环并记录。
var errAgentStopped = errors.New("认证失败：Agent Token 无效或服务器不存在，停止重连")

// errNotImplemented 骨架占位：连接协议（task19）尚未合入
var errNotImplemented = errors.New("连接协议尚未实现")

// run 连接循环框架（task19 填充 connectOnce 的协议细节），退出语义：
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

// connectOnce 建立一次到 Hub 的长轮询连接并维持到其结束（task19 实现）
//
// 协议约定见 controllers/AgentConnectController.php 文件头注释（task6 交付），
// 实现时严格对齐，禁止自行增删字段：
//   - 请求：GET {HubURL}/api/agent/connect，凭据只走请求头 X-Agent-Token；
//     必须用 http.NewRequestWithContext 绑定 ctx（优雅退出）；
//   - 响应：application/x-ndjson 按行读取（bufio.Scanner，空行跳过）：
//     {"cmd":"collect"}               → 采集全量快照并经 POST /api/agent/report 回传（task17/18/7）；
//     {"ok":true,"action":"reconnect"} → 正常到期，返回 nil（run 立即重连、不退避）；
//     {"ok":true,"action":"reconnect","reason":"superseded"} → 被新连接挤占，返回可重试错误（run 退避重连）；
//   - 非 200：401 → 返回 errAgentStopped；403（服务器已暂停）→ 返回可重试错误；
//     网络错误 / 5xx → 包装原错误返回，交由 run 的退避框架处理。
//
// 骨架阶段（本任务）先返回 errNotImplemented：行为上走退避重连路径，既让
// 框架可观察，又不会形成空转热循环。
func (a *agent) connectOnce(ctx context.Context) error {
	// TODO(task19): 按上述协议约定实现长轮询：建连（带 Token 请求头）→
	// 逐行读取 ndjson → collect 指令触发采集回传 → 按结束行 / 状态码返回
	return errNotImplemented
}
