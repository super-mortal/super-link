# 服务器监控（Server Monitor）产品需求文档

| 项目 | 内容 |
| --- | --- |
| 版本 | 1.5 |
| 日期 | 2026-11-27 |
| 状态 | 已实施（分组字典与相关界面随 v0.1.2 候选落地） |
| 关联文档 | [账号库 PRD](account-vault.md)、[优化 PRD](optimization.md) |
| 关联原型 | `mockups/index.html`（本地纯 HTML 交互原型，按 `.gitignore` 不入库） |
| 参考项目 | [henrygd/beszel](https://github.com/henrygd/beszel)（Hub + Agent 长连接架构、信息架构与视觉参考；本地源码副本 `docs/beszel/`，不入库） |
| 说明 | 本文档记录 super-link 新增「服务器」监控模块的产品需求。只记录已与用户确认的决策；未确认的候选放第 10 节，不进正文。 |

## 1. 背景与目标

### 1.1 背景

用户自托管多台服务器（VPS / 家庭服务器），需要一个地方统一查看各机器的运行状况。参考项目 beszel 采用 Hub + Agent 架构解决了这个问题，但它是独立系统（Go + PocketBase），与 super-link 的数据、账号体系、UI 完全隔离。

super-link 的定位是「自托管的个人数据管理工具」，服务器状态是个人数据的一类。把监控能力作为第四个模块并入 super-link，可以在同一套自托管环境里同时管理书签、Skill、账号与服务器。

### 1.2 目标

1. **统一入口**：侧栏新增「服务器」模块，集中管理所有被监控机器。
2. **极度轻量的探针**：常驻守护进程，Go 静态二进制（双架构约 15MB 级、常驻内存约 10MB，与 beszel agent 同级）；agent 主动外连 Hub 并保持长连接，NAT 后无需公网 IP。
3. **自包含**：不依赖 SSH 凭据，Agent 通过独立 Token 认证；super-link 只做数据存储与展示。
4. **与现有产品一致**：沿用侧栏、暗色主题、弹窗、toast 与响应式行为；参考 beszel 的信息层级组织详情页。

### 1.3 非目标（首版不做）

- 主动告警通知（邮件 / Webhook / Telegram 等）——已确认暂不做，只在页面内展示状态；
- SSH 远程执行、文件管理、Web 终端等运维操作；
- Windows / macOS 被监控端（首版仅支持 Linux，后续按需扩展）；
- 多用户权限体系（沿用 super-link 单用户 + 主密码的整体假设）；
- 日志采集、进程级 Top 列表、GPU / S.M.A.R.T. 等扩展指标（进程 Top 列表、GPU / S.M.A.R.T. 已列入候选 Q1 / Q5，后续迭代）。

## 2. 用户与典型场景

| 场景 | 描述 | 关键能力 |
| --- | --- | --- |
| 日常巡检 | 打开模块看所有机器是否在线、负载是否正常 | 列表状态徽章、CPU / 内存 / 磁盘概览 |
| 单机深看 | 某台机器最近变慢，看趋势定位 | 详情页 CPU / 内存 / 网络历史曲线、当前负载 |
| 磁盘水位 | 哪台机器磁盘快满了 | 各挂载点用量条、超阈值变色 |
| 容器排查 | 哪个容器在吃资源 | Docker 容器资源占用表（CPU / 内存 / 网络） |
| 新机接入 | 新开一台 VPS，加入监控 | 添加弹窗生成 Token + 一键复制的安装命令 |
| 机器退役 | 某台机器不再监控 | 删除服务器（连同历史数据） |

## 3. 术语

- **Hub**：即 super-link 后端（不另起名），负责接收回传、存储历史、提供查询与展示。
- **Agent（link-agent）**：被监控机器上运行的常驻守护进程（Go 静态二进制，systemd 托管），二进制名 `link-agent`、服务单元 `link-agent.service`、配置 `/etc/link-agent/config`；主动外连 Hub 并保持长连接，按 Hub 下发的指令采集本机指标并回传。
- **连接（长连接）**：agent 启动后主动向 Hub 发起并保持的连接；Hub 经该连接下发采集指令，agent 经该连接（或一次回传请求）返回快照。连接由 agent 侧重连维持。
- **快照（Snapshot）**：一次采集代表的机器当时状态（CPU / 内存 / 磁盘 / 网络 / 负载 / 开机时长 / Docker 容器列表）。
- **Agent Token**：每台服务器独有的认证凭据，添加时生成、仅在添加 / 重置弹窗内完整展示一次，服务端只存哈希；重装 agent 需重置 Token（弹窗给出含新 Token 的完整安装命令，见 §5.1）。
- **离线判定**：长连接断开或一个采集周期未回传，即标记离线，秒级生效；暂停中的服务器不判定。

## 4. 已确认决策

以下决策已在 2026-11-16 的讨论中与用户确认，是本文档的基线：

| # | 决策 | 说明 |
| --- | --- | --- |
| D1 | 完整自研监控体系 | Hub + Agent 上报架构；参考 beszel 的信息架构与体验，不对接 beszel |
| D2 | Agent 为 Go 静态二进制 daemon | 常驻守护进程（beszel 同构），linux/amd64 + arm64 双架构，约 15MB、常驻内存约 10MB；静态编译零依赖，systemd 托管；agent 主动外连 Hub，NAT 后无需公网 IP |
| D3 | 首版指标 = 基础系统指标 + Docker | 基础：CPU、内存、Swap、磁盘（各挂载点）、网络吞吐、系统负载、开机时长；Docker：容器名称 / CPU / 内存 / 网络 |
| D4 | 采集周期 5 分钟，历史明细保留 30 天 | Hub 每 5 分钟经长连接下发一次采集指令；超 30 天的明细数据直接清理，不做聚合保留 |
| D5 | 前端为独立路由 + 详情页 | 侧栏独立入口，自建列表外壳与单机详情页，不走 ModuleList 通用三布局（图表需要更大展示空间） |
| D6 | 不存储 SSH 凭据 | Agent Token 是唯一凭据；Token 仅添加 / 重置时完整展示一次，服务端存哈希 |
| D7 | 无主动告警通知 | 仅在页面内展示在线 / 离线 / 异常状态 |
| D8 | 被监控端首版仅支持 Linux | 数据源为 `/proc` 与标准命令；Windows / macOS 列入候选 |
| D9 | 图表库用 recharts | 实现阶段引入 recharts；原型中的手绘 SVG 仅为演示，不代表最终实现 |
| D10 | 分组为可管理的动态字典 | 内置「家庭 / 公网 / 公司 / 归档」四个种子分组，支持新增 / 重命名 / 删除（统一在「设置 → 分组」维护）；非空分组禁止删除（提示组内服务器数量），至少保留一个分组。`servers.group_name` 仍存名称，备份与 agent 协议零改动。CRUD 端点为 `GET/POST/PATCH /api/servers/groups` 与 `POST /api/servers/groups/delete`；列表 `groups` 计数按字典输出全部名称（为 0 也返回），新增 / 编辑只接受字典内名称（缺省取 sort 最小分组）；备份恢复遇到字典外分组自动建组并回传 `groups_created`。详见 [refinements-v0.1.2.md](refinements-v0.1.2.md) |
| D11 | 连接模式为长连接 | agent 常驻并主动保持到 Hub 的连接；Hub 每 5 分钟经连接下发采集指令；连接断开即离线（秒级）；PHP + Apache 约束下以长轮询实现该语义，不引入独立 WebSocket 服务进程 |
| D12 | link-agent 二进制随主版本发布 | 与 super-link 同 tag（`vX.Y.Z`）产出：CI 同时构建 Docker 镜像与 `link-agent-linux-amd64` / `link-agent-linux-arm64`，挂同一 GitHub Release；不做独立版本线；Hub 详情页对比自身与 agent 版本，落后时提示升级（beszel 同款） |
| D13 | 列表页支持卡片 / 列表两种视图 | 默认卡片；工具栏切换，视图选择按页面状态记忆（不做 URL 同步）；列表视图为单行摘要，窄屏逐级降级 |

## 5. 功能需求

### 5.1 服务器管理

- **分组**：动态字典（`server_groups` 表，内置「家庭 / 公网 / 公司 / 归档」四个种子），在「设置 → 分组」新增 / 重命名 / 删除，非空分组禁止删除、至少保留一个；模块内只做选择：侧栏按字典渲染分组及计数（为 0 的分组也展示）、点击筛选，添加 / 编辑弹窗用普通下拉并提示「分组在『设置 → 分组』里维护」（详见 [refinements-v0.1.2.md](refinements-v0.1.2.md)）。
- **列表**：支持卡片 / 列表两种视图（默认卡片，工具栏切换）。卡片视图（beszel SystemCard 同款结构）：头部条为状态点（在线绿 / 离线红 / 已暂停灰 / 等待连接黄）+ 名称，头部下方为系统信息行（发行版 · CPU 核数 · IP）；主体为「图标 + 标签 + 值」三列指标行——CPU / 内存 / 磁盘为行内 meter（数值 + 细条；CPU / 内存按 65 / 90 阈值变色，磁盘按 80 / 90；磁盘取用量最大挂载点，悬停展示全部分区），网络 / 运行时长 / 容器数为文本行；页脚为分组 + 状态文字与最后回传时间（暂停 / 等待连接仅展示状态文字）。离线卡片指标行置灰，页脚注明数据停留时间；暂停 / 等待连接的卡片整体置灰，等待连接暂无指标数据、不展示指标行，改用占位块（图标 + 标题 + 说明 + 可点击的「查看接入指引 →」，跳转详情页接入信息卡）。列表视图为单行摘要：状态徽章、名称 + 分组、系统信息、CPU / 内存 / 磁盘（带阈值色）与最近上报时间；点击整行进入详情；窄屏按 1100 / 860 / 640px 逐级隐藏磁盘、整组指标与时间。
- **新增 / 编辑**：弹窗内填写名称、备注与分组；新增提交后生成服务器与 Agent Token，并展示安装命令（含 Token 的一行 curl 命令）供一键复制。
- **Token 重置**：服务器详情内可重新生成 Token（旧 Token 立即失效）；重置弹窗直接给出含新 Token 的完整安装命令，一键复制到被监控机执行即完成重装，无需再找历史命令。
- **暂停 / 恢复**：可暂停某台服务器的监控（暂停期间不做离线判定，状态固定为「已暂停」，历史数据保留）。
- **删除**：删除服务器及其全部历史数据，二次确认。
- **空态**：无服务器时展示引导（标题「还没有监控任何服务器」+ 接入说明摘要：一行命令安装零依赖静态二进制守护进程，自动连接 Hub，每 5 分钟回传指标 +「添加服务器」按钮）。

### 5.2 Agent 与连接协议

- **Agent 形态**：Go 编写的单二进制守护进程（命名 `link-agent`），静态编译、零依赖；被监控机以 systemd 托管（`link-agent.service`），开机自启、崩溃自动重启（决策 D2）。
- **安装**：一行命令自动识别架构（`uname -m` → amd64/arm64）下载对应二进制（`link-agent-linux-amd64` / `link-agent-linux-arm64`）、写入配置（`/etc/link-agent/config`：`HUB_URL` 与 `AGENT_TOKEN`）、安装 systemd unit 并启动。安装命令由 Hub 生成，一键复制。
- **二进制分发**：agent 产物随主版本发布——同一个 `vX.Y.Z` tag 下 CI 同时产出 Docker 镜像与 `link-agent-linux-amd64` / `link-agent-linux-arm64`，挂同一 GitHub Release（决策 D12）；不做独立版本线，也就不存在「哪个 agent 配哪个 Hub」的兼容矩阵。安装脚本（`install-agent.sh`）由 Hub 提供：Apache 已有 `/content/* → api/index.php` 的 rewrite，只需在 `routes.php` 增加 `content/install-agent` 路由返回脚本文本（可顺带注入 Hub 地址），被监控机无需额外配置。
- **连接**：agent 启动后**主动外连** Hub 并保持长连接（决策 D11）。PHP + Apache 约束下以**长轮询**实现该语义：agent 发起带 Token 的请求并保持，Hub 需要数据时经该连接下发采集指令；不引入独立 WebSocket 服务进程，复用现有 `/api` 转发链路。实现约束（均经现有代码核实）：
  - 持有上限取 45–55 秒：生产镜像 `Dockerfile.build` 已设 `max_execution_time=60`，顶格持有会被 PHP 直接掐断；若 Hub 前置反代（nginx / Caddy），需同步调大 `proxy_read_timeout`；
  - 持有循环须每秒级 `flush()` + `connection_aborted()` 自检，否则 mod_php 下客户端断开只能等下次写输出才感知，「断开即离线（秒级）」无法兑现；
  - 每 Token 单活跃连接需要跨进程注册表（APCu 原子操作，或 SQLite 带过期时间戳的行）；
  - agent 端点应跳过 session：`framework/bootstrap.php` 每请求无条件 `startSession()`，长轮询会每次新建并锁定 session 文件；`DatabaseMigrations` 中间件每请求执行 `Repository::migrate()`（幂等但有开销），需在文档注明。
- **采集节奏由 Hub 控制**：每 5 分钟经连接下发一次采集指令，agent 采集全量快照后经连接（或一次回传请求）返回；数据时间戳以 Hub 接收时间为准，不信任客户端时钟。
- **离线判定**：连接断开或一个采集周期未回传，即标记离线，秒级生效；暂停中的服务器不判定。
- **断线重连**：由 agent 侧负责，指数退避重连；重连期间数据断档，图表以空档呈现。

### 5.3 采集指标

**基础系统指标**（每次采集全量快照）：

| 指标 | 数据源与口径 | 说明 |
| --- | --- | --- |
| CPU 使用率 | `/proc/stat` 两次采样增量：busy ÷ total，busy = total − idle − iowait；total 剔除 guest/guest_nice | 百分比，0–100；首次采样为 0，计数器重置时重建基线（与 beszel `agent/cpu.go` 一致） |
| 内存 | `/proc/meminfo`：以 gopsutil `Used` 口径为准（含 shmem），近似 MemTotal − MemAvailable；另报 buff/cache | used / total / cached；beszel 主路径即 gopsutil Used，仅在 Used > Total 时回退 Total − Available |
| Swap | `/proc/meminfo` | used / total |
| 磁盘 | `df -P`，只统计真实块设备；排除清单：proc、sysfs、tmpfs、devtmpfs、overlay、squashfs 及零块设备，bind mount 按 (major:minor) 去重 | 每个挂载点 used / total；beszel 范围更窄（root fs + `/extra-filesystems` + 配置项），我方范围更大，去重与排除清单必须封闭 |
| 网络 | `/proc/net/dev` 每网卡累计值增量 ÷ 实际间隔，**由 agent 侧直接算速率**（与 beszel 一致，Hub 不做换算）；排除 lo、docker*、br-*、veth*、bond*、cali* 与零计数器网卡 | bytes/s；预留 `NICS` 环境变量支持白 / 黑名单与通配符（beszel 同款，后续按需开放） |
| 负载 | `/proc/loadavg` | 1 / 5 / 15 分钟 |
| 开机时长 | `/proc/uptime` | 秒 |
| 系统信息 | `uname -a`、`/etc/os-release`、`nproc` | 首次或变化时回传：发行版、内核、CPU 核数 |

**Docker 指标**（每次采集全量快照，走 Docker Engine API，不用 `docker stats` CLI）：

| 指标 | 数据源与口径 | 说明 |
| --- | --- | --- |
| 容器列表 | Docker Engine API `/containers/json` + `/containers/{id}/stats` | 容器名、CPU %、内存用量、网络 RX / TX、运行状态 |
| 容器 CPU | 容器 cpu 增量 ÷ system 增量 × 100（**不乘 CPU 核数**：API 的 system_cpu_usage 本身就是全 CPU 累计，乘了会超 100%，beszel 会直接丢弃该样本） | 与 `docker stats` 显示值一致 |
| 容器内存 | usage − inactive_file（即 `stats.memory.stats` 口径） | 与 `docker stats` 显示值一致 |
| Docker 不可用 | API 连接失败或无权限 | 该字段为空即可，不影响其余指标回传 |

### 5.4 数据保留与清理

- 明细数据保留 30 天，由后端定时任务（或迁移时顺带执行）清理；到期直接删除，不建聚合表、不保留任何聚合数据（决策 D4）。
- 清理范围覆盖三张表明细：`server_metrics`、`server_disks`、`server_docker`（Docker 表行数 = 天数 × 288 × 容器数，不清会先涨爆）。
- 列表卡片指标与详情页图表从明细直接查询（30 天 × 288 点/天的量级 SQLite 可承受），30 天档由服务端按小时聚合后返回。

### 5.5 前端页面

- **路由**：`/servers`（列表）与 `/servers/:serverID`（详情），账号库式独立外壳；模块无敏感凭据，不需要解锁态。
- **侧栏**：分组筛选（`server_groups` 字典，按 sort 升序、为 0 的分组也展示，带计数），点击筛选、再点取消；不设「全部」行，无选中即全部。
- **列表页**：5.1 的卡片 / 列表两种视图（默认卡片）+ 「添加服务器」主按钮；顶部工具栏含搜索（名称 / 备注 / IP）、排序（状态 / 名称 / CPU / 内存）与视图切换（卡片 / 列表）。列表视图一行展示状态徽章、名称 + 分组、系统信息、CPU / 内存 / 磁盘与最近上报；窄屏逐级隐藏磁盘、整组指标与时间。
- **详情页**：
  - 头部：名称、分组、连接状态徽章（在线 / 离线 / 已暂停 / 等待连接）、系统信息（发行版 · CPU 核数 · IP）、开机时长与当前负载（在线时展示）、最后回传时间；
  - 图表区：CPU、内存、网络三张图（**recharts**，面积图 / 折线图；默认近 6 小时，可切换 1 小时 / 24 小时 / 30 天）；
  - 磁盘区：各挂载点用量条（超 80% 警示色，超 90% 危险色）；
  - Docker 区：容器表格（名称 / 状态 / CPU / 内存 / 网络）；
  - 接入信息卡：安装命令**模板**（`<AGENT_TOKEN>` 占位，不含明文 Token，D6）+ 说明「完整含 Token 的命令在添加 / 重置弹窗内展示，重装请点上方「重置 Token」」；
  - 操作：编辑（名称 / 备注 / 分组，原型暂未覆盖，实现时补齐）、暂停 / 恢复、重置 Token、删除。
- **刷新**：连接状态实时反映（断开即时）；指标快照每 30 秒轮询；列表页进入时刷新。
- **版本提示**：详情页基本信息展示 agent 版本；与 Hub 版本不一致（落后）时给出可升级提示（决策 D12，beszel 同款；原型已展示版本值，落后提示 UI 暂未覆盖）。
- **图表**：暗色主题可用；选型已定为 recharts（决策 D9）。

### 5.6 安全

- 连接与回传端点跳过用户会话认证（Agent 无会话），仅凭 `X-Agent-Token`（或配置等价请求头）校验；Token 哈希存储，校验失败返回 401 并不泄露服务器存在性。
- Token 哈希算法：SHA-256 + 每服务器随机 salt（token 本身高熵，无需 KDF；与账号库主密码的 Argon2id 区分场景）。
- 「不泄露存在性」的落地：connect / report 对「无效 Token」与「不存在的服务器」返回**完全一致**的 401（响应体与耗时都要一致）。
- 连接端点按 Token 维度限流与并发上限（每个 Token 同时只允许一条活跃连接，注册表见 §5.2），防止恶意占持 worker 或刷写。
- 采集数据做范围校验（CPU 0–100、内存不大于总量等）；另设单包大小上限与字段白名单（防 SQLite 膨胀与注入面）；「截断 vs 拒绝」按字段性质定：结构性字段（容器名等）超限拒绝，数值字段截断。
- CSRF 中间件不适用于 Token 请求头形态的 agent 请求，需明确豁免规则（写操作校验仅针对用户会话请求）。

## 6. 数据模型与接口草案

> 本节为草案，实现前需再过一轮评审。**路径风格已按现有框架定稿**：`framework/Router.php` 只支持 `路径/METHOD` 精确匹配、无路径参数，现有端点惯例为「子路径 + 查询串传 id」（如 `/api/skills/detail?id=`、`/api/accounts/detail`），服务器端点沿用同一惯例。

**数据表**：

- `servers`：`id`、`name`、`note`、`group`（分组名称，库内列名 `group_name`；候选值来自 `server_groups` 字典）、`token_hash`、`token_salt`、`paused`、`last_report_at`、`created_at`、`updated_at`
- `server_groups`：`id`、`name`（唯一）、`sort`；内置家庭 / 公网 / 公司 / 归档四个种子（空表时写入，删除后不被 migrate 复活），`migrate()` 每次把 `servers.group_name` 里字典缺失的名称回填进来
- `server_metrics`：`id`、`server_id`、`received_at`、`cpu`、`mem_used`、`mem_total`、`mem_cached`、`swap_used`、`swap_total`、`load1`、`load5`、`load15`、`net_rx`、`net_tx`（**速率 bytes/s，agent 侧算好**）、`uptime`
- `server_disks`：`id`、`server_id`、`received_at`、`mount`、`used`、`total`
- `server_docker`：`id`、`server_id`、`received_at`、`container`、`cpu`、`mem_used`、`mem_limit`、`net_rx`、`net_tx`（速率 bytes/s）、`state`
- 系统信息（内核 / 发行版 / 核数）变化时更新 `servers` 的冗余字段或单独 `server_system` 表。

**接口**（用户态，全部走会话认证；响应用 `success()` 包裹，与账号库等新接口一致）：

- `GET /api/servers`：列表 + 每台最新快照摘要与连接状态
- `POST /api/servers`：新增，返回 `{ server, token }`（token 仅此次返回）与安装命令
- `PATCH /api/servers`：改名 / 备注 / 分组 / 暂停恢复
- `POST /api/servers/delete`：删除
- `GET /api/servers/detail?server-id=`：详情（基本信息 + 系统信息 + 最新 Docker 快照 + 连接状态）
- `GET /api/servers/metrics?server-id=&range=1h|6h|24h|30d`：历史序列（服务端按 range 聚合）
- `POST /api/servers/token`：重置 Token
- `GET /api/servers/groups`：分组字典 `{ groups: [{ id, name, sort, count }], total }`（字典内分组全部返回，为 0 也返回）
- `POST /api/servers/groups` / `PATCH /api/servers/groups` / `POST /api/servers/groups/delete`：新增 / 重命名 / 删除分组（id 走请求体；重名 400、非空 400、至少保留一个）；重命名在同一事务内同步 `servers.group_name`
- `GET /api/servers` 的 `groups` 计数按字典输出全部名称；`POST/PATCH /api/servers` 只接受字典内分组，新增缺省取 sort 最小的分组
- 备份恢复：`POST /api/backup/servers/restore` 遇到字典外分组自动建组，并在预检 / 执行响应里返回 `groups_created`（自动新建分组数）

**接口**（agent 态，Token 认证，跳过会话与 CSRF 中间件——按控制器类名加入 `AuthenticationMiddleware::$skip_auth_routes` 与 `CSRFMiddleware::$skipped_routes`，与 `AuthLoginController` / `AppInfoController` 现成模式一致）：

- `GET /api/agent/connect`：长轮询接入（请求保持，Hub 经此下发采集指令；GET 天然跳过 CSRF）
- `POST /api/agent/report`：回传快照（需显式加入 CSRF 豁免）
- `GET /content/install-agent`：返回安装脚本文本（`Content-Type: text/x-shellscript`，可注入 Hub 地址）。注意这是**顶层 `content` 路由键**（Apache 把 `/content/*` 与 `/api/*` 一并转发到 `index.php`，`SCRIPT_URL` 原样参与路由匹配），不在 `api` 下；该端点需加入认证跳过名单（被监控机未登录）

## 7. 验收标准（MVP）

1. 添加服务器后，按安装命令在被监控 Linux 机器部署 agent（systemd 服务），连接建立后列表即显示在线（秒级）。
2. 列表正确展示在线 / 离线状态（停止 agent 服务后秒级标记离线）。
3. amd64 与 arm64 两种架构的二进制均可正常安装、连接与采集。
4. 详情页三张图表与磁盘、Docker 数据与 `htop` / `df` / `docker stats` 肉眼一致。
5. 30 天数据保留（retention）策略可通过模拟数据验证清理逻辑。
6. 删除服务器后其历史数据一并删除。
7. 侧栏分组筛选与计数正确（按字典渲染、为 0 也展示）；分组可在设置页新增 / 重命名 / 删除（非空拒绝、至少保留一个）；新增 / 编辑可设置分组；恢复备份时未知分组自动建组并在结果中提示新增数量。
8. 暗色 / 亮色主题下全部新界面元素可读，无硬编码亮色。
9. `npm run build` 全绿（前端最低验证标准）。

## 8. 风险与取舍

- **全量快照**：每次采集回传全量，不做增量，实现简单；30 天 × 288 点/天的写入量对 SQLite 可控。
- **无 agent 本地缓存**：断线期间数据缺失（曲线断点），换取 agent 简单；重连后由 Hub 下发的下一周期自然续上。
- **常驻内存**：每台被监控机约 10MB RSS（beszel 同级），个人级服务器数量下可接受。
- **长连接的 PHP 实现约束**：Apache worker 会被长轮询请求占持，保持上限取 45–55 秒（避开 `max_execution_time=60`）+ 每 Token 单连接限制；个人级（<20 台）可接受，规模增长需评估（如迁移至独立 WS 服务）；Hub 前置反代时需同步调整超时。
- **Go 工具链与分发**：项目新增 Go 构建矩阵（amd64/arm64）与 Releases 托管；二进制信任链（签名校验）见候选 Q7。
- **框架适配**：Router 无路径参数（§6 已按查询串惯例定稿接口）；agent 端点需加入两个中间件的跳过名单；`bootstrap.php` 的 session 与 `DatabaseMigrations` 每请求执行对长轮询有副作用（对策见 §5.2）。
- **仅 Linux**：首版明确边界，避免 agent 逻辑分叉。
- **服务端时间戳**：不信任客户端时钟，代价是无法还原 agent 侧真实采集时刻（5 分钟周期下可忽略）。

## 9. beszel 实现细节研究笔记

> 2026-11-16 通读 [henrygd/beszel](https://github.com/henrygd/beszel) 源码（本地副本 `docs/beszel/`，不入库）后的 factual 记录。**我方 agent 已确认采用与 beszel 同构的长连接 daemon 架构（D2/D11）**。**本节为参考笔记，不构成需求，仅供实现对照**。beszel 为 MIT 许可；目前只参考架构与口径，未拷贝代码，故 README 无需声明（若实现时确实引用其代码，将按约定在 README 致谢补充）。

### 9.1 连接与认证（我方采用的同构设计）

- beszel：agent **主动外连** hub，优先 WebSocket，失败则 agent 本地起 SSH server 让 hub 拨入（`agent/connection_manager.go`）；连接断开自动重连。
- 我方（D11）：同为 agent 主动外连 + 长连接 + 自动重连；PHP/Apache 约束下以长轮询实现，不做 SSH 回退（不需要 hub 反向拨入，也就没有 SSH 凭据面）。
- beszel 认证：hub 下发签名挑战，agent 用 SSH 私钥签名；身份是持久化的「机器指纹」（`agent/fingerprint.go`，存于 agent 数据目录）。
- 我方：Token 认证（D6）。指纹思路可借鉴：换 Token 不换机器身份，便于重装 agent 后自动归位（列入实现时考虑）。

### 9.2 采集口径（对应 5.3，均已核对源码）

- **CPU**：`/proc/stat` 增量，busy = total − idle − iowait，Linux 下 total 剔除 guest/guest_nice；计数器回绕时重建基线，首采样报 0（`agent/cpu.go`、`agent/cpu_linux.go`）。LXC 内走 cgroup 口径。
- **内存**：gopsutil VirtualMemory（used 不含可回收 buff/cache），另报 buff/cache 与 ZFS ARC；`MEM_CALC=htop` 提供另一种口径（`agent/memory.go`）。
- **磁盘**：只统计真实设备，root fs 之外支持 `/extra-filesystems` 附加挂载点；设备名解析 symlink 以对齐 diskstats（LVM/dm）（`agent/disk.go`）。
- **磁盘 I/O**：`/proc/diskstats` 增量（扇区 × 512），另报读写时间百分比与 await（`agent/disk.go`）。
- **网络**：`/proc/net/dev` 增量 ÷ 耗时；默认排除 `lo`/`docker*`/`br-*`/`veth*`/`bond*`/`cali*` 与零计数器网卡；`NICS` 环境变量支持白/黑名单与通配符（`agent/network.go`）。
- **Docker**：走 Docker Engine API；容器 CPU% = 容器 cpu 增量 ÷ system 增量 × 在线 CPU 数；网络 rx/tx 增量跟踪；支持按名字模式排除容器（`agent/docker.go`）。
- **系统信息**：hostname/arch/发行版/内核/CPU 型号/核数线程数，容器内按 cpuset 修正（`agent/system.go`）。

### 9.3 Hub 存储（PocketBase，与本项目 SQLite 方案对照）

- 每分钟一条记录，stats 以 JSON blob 存储；后台任务做**分层滚动聚合**：1m→10m→20m→120m→480m（`internal/records/records.go`）。
- 分层保留：1m/1 小时、10m/12 小时、20m/24 小时、120m/7 天、480m/30 天（`internal/records/records_deletion.go`）。
- 离线判定：beszel 靠连接断开 + 3 分钟静默兜底（3 × 1 分钟周期，`internal/hub/systems/system.go`）；我方为连接断开即离线（秒级），一个采集周期未回传兜底。
- 对照结论：分层聚合让任意缩放级别都有合适分辨率且存储有界；我们按 D4 只保留 30 天明细，30 天档图表由服务端按小时聚合查询返回，存储与实现更简。
- 版本提示：beszel 在系统列表的 agent 版本列按「是否与 Hub 同版本」显示绿 / 黄（`systems-table-columns.tsx`）；我方按 D12 在详情页基本信息做落后提示。

### 9.4 告警（首版不做，仅记录设计参考）

- 阈值告警覆盖 CPU/内存/磁盘/温度/容器/网络探测等，支持静默时段与多种通知渠道（`internal/alerts/`）；只在状态变化时通知。若后续做 Q 类候选项，可参考其阈值与去重设计。

## 10. 候选与待确认

以下条目尚未确认，不在正文作为需求：

| # | 事项 | 说明 |
| --- | --- | --- |
| Q1 | 进程 Top 列表 | 详情页是否需要 Top 进程（agent 多采集 `ps`） |
| Q2 | 网络接口明细 | 网卡级 RX / TX 而非合计 |
| Q3 | 温度传感器 | `/sys/class/thermal` / lm-sensors |
| Q4 | Windows / macOS agent | Go 交叉编译对应平台二进制（beszel 即如此），注意指标数据源差异 |
| Q5 | GPU / S.M.A.R.T. | 扩展硬件指标；Go agent 下已具备可行性（beszel 有现成实现可对照） |
| Q6 | 批量接入 | 多台机器时安装命令的批量生成 / 配置文件分发 |
| Q7 | 二进制签名校验 | link-agent 二进制与安装脚本的签名校验，完善分发信任链 |

## 11. 变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v0.1 | 2026-11-16 | 初稿：确认 Hub + Agent 架构、Shell 脚本 agent、基础 + Docker 指标、5 分钟 / 30 天保留、独立路由详情页、无 SSH 凭据、无主动告警 |
| v0.2 | 2026-11-16 | 补充确认：图表用 recharts（D9）、历史只留 30 天明细不做聚合（D4 收紧）、首版支持简单分组（D10，家庭 / 公网 / 公司 / 归档）；候选项收敛为 Q1–Q6 |
| v0.3 | 2026-11-16 | 通读 beszel 源码后细化采集口径（§5.3：CPU 增量公式、内存 = total − available、磁盘排除伪文件系统、网络排除虚拟网卡、容器 CPU 口径）；新增 §9 研究笔记（连接认证 / 采集口径 / 分层保留 / 告警设计） |
| v0.4 | 2026-11-16 | **D2 改为 Go 静态二进制 daemon、新增 D11 长连接**：agent 常驻并主动保持到 Hub 的连接（beszel 同构），Hub 每 5 分钟经连接下发采集指令，离线秒级感知；PHP/Apache 下以长轮询实现，不引入独立 WS 进程。同步重写 §5.2 协议、§6 接口（`/api/agent/connect`、`/api/agent/report`）、§7 验收、§8 风险；原型安装命令与连接状态展示同步调整 |
| 1.0 | 2026-11-16 | 文档定版 1.0；命名确定：agent 二进制为 **link-agent**（服务 `link-agent.service`、配置 `/etc/link-agent/config`、产物 `link-agent-linux-amd64` / `link-agent-linux-arm64`），Hub 即 super-link 后端不另起名；**D12**：二进制随主版本同 tag 发布，不做独立版本线，详情页做 agent 版本落后提示；原型同步改名。同日审查修订：§5.1 卡片描述对齐原型（磁盘 80 / 90 阈值、置灰范围、系统信息行、空态文案）、§2 与 §5.4 移除 sparkline 残留、§5.5 状态徽章改四态并标注编辑 / 版本提示原型未覆盖、§5.1 暂停文案去除「告警」表述、§1.3 候选引用对齐 Q1 / Q5、§9 标注「参考、非需求」、签名校验移入 Q7、§7 保留策略措辞（D1–D12 未动） |
| 1.1 | 2026-11-16 | 技术审查修订（D1–D12 未动）：修正 Docker 容器 CPU 口径（删除错误的「× 在线 CPU 数」，beszel 为 cpuDelta ÷ systemDelta × 100）、容器内存口径（usage − inactive_file）；网络口径统一为 agent 侧算速率并补 cali* / 零计数器排除与 NICS 预留；内存口径注明以 gopsutil Used 为准；磁盘排除清单封闭化（含 squashfs 与 bind mount 去重）；§6 接口按现有 Router 约定改写为查询串传参（原 `{id}` 路径参数框架不支持）、补 `success()` envelope、中间件按类名豁免、新增 `GET /content/install-agent`（顶层 content 路由，需认证豁免）；§5.2 补长轮询实现约束（45–55s 持有避开 max_execution_time、connection_aborted 每秒自检、每 Token 单连接注册表、跳过 session）；§5.6 补 Token 哈希算法（SHA-256 + salt）、无效 Token 与不存在服务器返回一致 401、单包上限与字段白名单；§5.4 清理覆盖三张表；§8 补框架适配风险 |
| 1.2 | 2026-11-16 | **D6 执行方式定稿（选项 b）**：Token 不在详情页回看——服务端只存哈希，明文仅在添加 / 重置弹窗展示一次；详情页「接入信息」卡改示安装命令模板（占位符），重装走「重置 Token → 弹窗给完整命令」流程。同步修正术语、§5.1 重置说明、§5.5 接入信息卡描述；原型详情页移除含 Token 的安装命令与复制按钮。备注：beszel 为另一派（token 明文存 PocketBase 可随时回看），本项目选择更严的口径 |
| 1.3 | 2026-11-26 | 分组字典落地（refinements-v0.1.2）：D10 补 CRUD 端点与字典口径；§5.1 分组与卡片布局对齐实现（分组移入页脚、等待连接占位块与「查看接入指引 →」）；§5.5 侧栏分组改字典驱动；§6 新增 `server_groups` 表、四个分组端点与恢复 `groups_created`；§7 验收补分组管理与自动建组。D1–D12 其余决策未动 |
| 1.4 | 2026-11-26 | 新增 D13：列表页支持卡片 / 列表两种视图（默认卡片，工具栏切换）；§5.1 / §5.5 同步列表视图的信息层级与窄屏降级规则 |
| 1.5 | 2026-11-27 | D13 生产实现落地：`ServerToolbar` 视图切换、`ServerListRow` 单行摘要与 1100 / 860 / 640px 逐级降级（决策与验收口径未变） |
