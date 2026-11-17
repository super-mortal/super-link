# link-agent（agent/）

super-link 服务器监控模块的被监控端守护进程（PRD：`../docs/prd/server.md` §5.2 / 决策 D2 / D11）。

Go 编写的静态单二进制、零第三方依赖，由 systemd 托管（开机自启、崩溃自动重启）。
agent 启动后主动外连 Hub 并保持长连接（长轮询语义），按 Hub 下发的采集指令回传
本机指标快照（CPU / 内存 / 磁盘 / 网络 / 负载 / 开机时长 / Docker 容器）。

## 目录结构

| 文件 | 说明 |
| --- | --- |
| `main.go` | 入口：配置加载、日志、信号处理（SIGTERM/SIGINT 优雅退出）、连接循环框架 |
| `config.go` | 配置：`/etc/link-agent/config`（KEY=VALUE）+ 环境变量覆盖 |
| `backoff.go` | 指数退避重连框架（初始 1s、倍数 2、上限 60s、±20% 抖动） |
| `backoff_test.go` | 退避框架单元测试（`go test ./...`） |
| `cpu.go` | CPU 采集器：`/proc/stat` 两次采样增量（首采样报 0、计数器重置重建基线，PRD §5.3 口径） |
| `memory.go` | 内存 / Swap 采集器：`/proc/meminfo`（gopsutil Used 口径 + buff/cache + Swap） |
| `disk.go` | 磁盘采集器：`df -P -k` 拿数字 + `/proc/self/mountinfo` 拿 fstype 与 major:minor（排除清单 + bind mount 去重） |
| `network.go` | 网络采集器：`/proc/net/dev` 增量 ÷ 实际间隔得速率（NICS 白/黑名单预留扩展点） |
| `load.go` | 负载采集器：`/proc/loadavg` 前三列 |
| `uptime.go` | 开机时长采集器：`/proc/uptime` 第一列 |
| `system.go` | 系统信息采集器：`/etc/os-release`（PRETTY_NAME）+ 内核版本 + 核数 + 架构 |
| `snapshot.go` | `Snapshot` 结构体（JSON 字段与后端 report 白名单逐字段对齐）+ `Collector.CollectAll()` 全量采集 |
| `cpu_test.go` / `memory_test.go` / `disk_test.go` / `network_test.go` / `load_test.go` / `uptime_test.go` / `system_test.go` | 采集器纯函数单测（fixture 字符串，不依赖真实 `/proc`） |
| `link-agent.service` | systemd unit 模板（与 `install-agent.sh` 内嵌 unit 一致，改一边必须改另一边） |
| `install-agent.sh` | 被监控机安装脚本（单一事实源，Hub 经 `/content/install-agent` 下发） |

采集器全部经标准库读 `/proc` 与执行 `df`，**不写 `//go:build linux`**：Windows
开发机上 `go vet` / `go test` / 交叉编译均可通过，非 Linux 运行期因数据源缺失
而降级（零值 + 日志）；agent 按决策 D8 只部署在 Linux。Docker 采集（task18）
填充 `snapshot.go` 的 `Docker` 字段；task19 把 `Collector.CollectAll` 接入
`main.go` `connectOnce` 的 collect 指令处理。

## 构建

```bash
# 本地（开发机）构建
go build -o link-agent .

# 交叉编译（决策 D2：linux/amd64 + linux/arm64，静态编译；版本随主版本
# 发布，决策 D12，版本号经 -ldflags 注入，Hub 详情页据此做落后提示）
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-X main.version=v0.0.6" -o link-agent-linux-amd64 .
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "-X main.version=v0.0.6" -o link-agent-linux-arm64 .

# 校验（提交前门槛）
gofmt -l . && go vet ./... && go test ./...
```

模块名 `github.com/super-mortal/super-link/agent`，`go.mod` 声明 `go 1.23`（保守
下限，CI 的 setup-go 安装 ≥1.23 即可构建）。零第三方依赖：采集全部走标准库
（`/proc`、`net/http`、`encoding/json`），Docker 采集直连 Docker Engine API
（Unix socket），不用 SDK、不用 `docker stats` CLI。

## 配置

优先级：环境变量 > 配置文件 `/etc/link-agent/config`（安装脚本写入，含凭据，
权限 600）。

| 键 | 环境变量 | 必填 | 说明 |
| --- | --- | --- | --- |
| `HUB_URL` | `HUB_URL` | 是 | super-link（Hub）对外地址，如 `https://link.example.com` |
| `AGENT_TOKEN` | `AGENT_TOKEN` | 是 | 本机 Agent Token（只走 `X-Agent-Token` 请求头，添加 / 重置时完整展示一次） |

缺失必填项时 agent 报错退出（中文错误信息，`journalctl -u link-agent` 可见）。
其它默认值（采集周期 300s、长轮询连接超时 70s、普通请求超时 30s）见
`config.go` 的 `DefaultConfig()`。

## 与 install-agent.sh 的关系

安装脚本负责：识别 CPU 架构 → 从 GitHub Release 下载对应静态二进制并校验
SHA-256 → 安装到 `/usr/local/bin/link-agent` → 写入配置 → 安装
`link-agent.service` 并启动。本目录的 `link-agent.service` 是同一 unit 的模板
副本（内容逐字节一致），修改时必须同步脚本内嵌的 heredoc。
