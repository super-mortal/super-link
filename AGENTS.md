# AGENTS.md

本文件为 AI 编码代理提供**开发阶段**的项目指南。修改代码前先读本文件。部署、发布与运维相关内容不在这里，见 README.md。

> **本文件的维护**：项目相关变更（架构、命令、目录结构、约定等）发生时，代理必须同步更新本文件，无需事先征求同意；任务结束时向用户报告"更新了 AGENTS.md"及具体更新点。

## 项目概览

super-link 是自托管的个人数据管理工具，从书签管理起步，通过模块机制扩展（当前：书签、Skill、账号库；服务器监控为独立路由，不进模块注册表，决策 D5）。数据完全由用户自持。

- 前端：React 19 + TypeScript 5.8 + Vite 7 SPA（`frontend/`）
- 后端：PHP 8.4 + Apache，纯 JSON REST API（无服务端渲染 UI）
- 数据库：SQLite（默认 `storage/link_navigator.db`）
- 文档：产品需求文档放在 `docs/prd/`；账号库见 [docs/prd/account-vault.md](docs/prd/account-vault.md)，优化项见 [docs/prd/optimization.md](docs/prd/optimization.md)，服务器监控（Hub + link-agent）见 [docs/prd/server.md](docs/prd/server.md)；本地 HTML 高保真交互原型在 `mockups/`（不随仓库提交）

## 版本发布记录

| 版本 | 发布日期 | 说明 |
| --- | --- | --- |
| v0.0.6 | 2026-11-12 | 侧栏高亮 / 底部黑边 / 卡片遮挡修复；更新日志、GitHub 三档网络设置、登录页介绍；标签按模块隔离（含数据库迁移）、筛选横幅移除、卡片槽位、侧栏动效 |
| v0.0.5 | 2026-11-10 | 账号库（加密账号 / 分组 / 平台 / TOTP）、设置页账号库分区与加密导出导入 |

- 当前版本号写在根目录 `app-info.json` 的 `version` 字段；`GET /api/app-info` 与登录页 / 设置页的版本号都取自此文件，**发版时必须同步更新**。
- 发布流程：整理版本号与四段式发布说明 → 用户过目确认 → 更新 `app-info.json` 并提交 → 打 `vX.Y.Z` tag 并推送 → CI 自动发布：`.github/workflows/docker-publish.yml` 构建 Docker 镜像推 GHCR 并创建 GitHub Release，`.github/workflows/link-agent-release.yml` 交叉编译 link-agent 双架构二进制及 `.sha256` 上传同一 Release。未经用户确认不得执行后四步。
- **Release 说明**：CI 的 `softprops/action-gh-release` 使用 `body_path: docs/releases/<tag>.md` + `generate_release_notes: true`——发布说明写成 `docs/releases/vX.Y.Z.md`（四段式）随 tag 一起提交，Release body 即为该文件内容（后附自动生成的 changelog 链接）；文件缺失时 action 警告并回退为纯自动生成，不会导致发布失败。应用内「查看更新内容」弹窗展示的就是该 body。
- **发布产物**：同一 tag 同时产 Docker 镜像（推 GHCR）与 link-agent 双架构二进制（`link-agent-linux-amd64` / `link-agent-linux-arm64` + 同名 `.sha256`，挂同一 GitHub Release；版本随主版本，决策见 [docs/prd/server.md](docs/prd/server.md) D12）。

## 协作与发布流程

### 产品阶段：原型 + PRD 先行

- 新功能 / 优化先在本地 `mockups/` 做**高保真可交互原型**（living prototype），并同步更新 `docs/prd/` 下对应 PRD。
- **用户未明确同意进入实现阶段前，不写生产代码**：只改原型、PRD 与文档；代码改动需单独确认。
- 原型与 PRD 必须同一轮一起变；PRD 的「已确认决策 / 变更记录」要写清影响范围。
- `mockups/` 不入库；验证截图、录屏、临时 HTML、浏览器 profile 等产物必须清理。

### 版本发布：必须用户确认

- 发布前先整理版本号、更新日志与影响范围，交给用户过目。
- **用户明确确认前**：不推送 tag、不创建 GitHub Release、不 `git push`、不把版本信息写入 `AGENTS.md`。
- 用户确认后，才可执行发布相关操作，并把版本信息 / 发布流程同步到 `AGENTS.md`。
- 发布说明建议按「新增 / 修复 / 优化 / 升级提示」四段编写；应用内通过 GitHub Release 的 `body` 展示（见 `docs/prd/optimization.md` O-4）。

## 技术栈与版本

| 层 | 关键依赖 |
| --- | --- |
| 前端 | React 19、TypeScript 5.8、Vite 7、Tailwind CSS 4（`@tailwindcss/vite`）、MobX 6、react-router-dom 6 |
| 组件 | shadcn/ui（new-york、neutral、CSS 变量）+ Radix；combobox 使用 `@base-ui/react` |
| 表格/表单 | `@tanstack/react-table`、react-hook-form + zod |
| 图表 | `recharts`（决策 D9，服务器详情页指标趋势；SVG presentation attribute 不解析 CSS 变量，语义色经 `getComputedStyle` 解析后传入） |
| 图标 | `lucide-react` 为主，`@tabler/icons-react` 补品牌图标 |
| 后端 | PHP 8.4、Apache + mod_rewrite、SQLite PDO、Composer |

## 常用命令

### 前端（均在 `frontend/` 目录执行）

```bash
npm ci                  # 安装依赖（有 package-lock.json，禁止 npm install）
npm run dev             # Vite dev server
npm run build           # 完整校验：prettier 检查 → eslint → tsc -b → vite build
npm run lint            # 仅 eslint
npm run lint:fix        # eslint 自动修复
npm run format:check    # 仅 prettier 检查
npm run format          # prettier 自动修复
npm run preview         # 预览构建产物
```

- **前端没有自动化测试**。任何前端改动的最低验证标准是 `npm run build` 全绿。
- ESLint 的 `no-console` 是 error：提交前不要留 `console.log`，否则构建失败。
- `src/components/ui/**` 与 `vite.config.ts` 被 ESLint 忽略，但仍应遵循 shadcn 原语风格。

### 后端

```bash
composer install --no-dev --optimize-autoloader   # 运行时依赖：guzzlehttp/guzzle、respect/validation
```

- 后端**没有测试框架、没有 test 脚本**。
- 本地验证需要 Apache + mod_rewrite 的等价环境（`/api`、`/content` 转发到 `public/api/index.php`）。
  直接用 `php -S` 时，需自备 router 注入 `$_SERVER['SCRIPT_URL']`（Apache 才提供该变量），否则路由匹配会失败。
- 可用环境变量：`DB_NAME`（默认 `link_navigator`）；`GITHUB_ACCESS_MODE`（`auto`/`proxy`/`direct`，默认 `auto`）、`GITHUB_PROXY_PREFIX`（代理前缀，默认空）、`APP_UPDATE_CHECK`（默认 `true`）——后三者仅作为初始默认值，设置页保存后以数据库为准（PRD O-5）。

## 本地开发环境

- 前端 dev server 把 `/api`、`/content` 代理到 `http://host.docker.internal:$BACKEND_PORT`（默认 `8000`）。
  若本机无法解析该主机名，需要在 hosts 中指向本机，或临时把代理目标改为 `127.0.0.1`。
- 主题默认 `system`，localStorage key 为 `faved-ui-theme`（历史命名，勿随意改）。
- 布局偏好：`layout`（list/cards/table）、`column-visibility-<module>-<layout>`、`app:preferences`。
- 侧栏拖拽布局由 `react-resizable-panels` 持久化，`useDefaultLayout({ id: 'dashboard-layout' })`。

## 架构要点

### 前端（`frontend/src/`）

- 入口 `main.tsx` → `App.tsx`（react-router-dom 路由表），全局唯一样式 `index.css`。
- 路由：`/` 列表、`/login`、`/setup` 及三步引导、`/create-item`、`/edit-item/:itemID`、`/skills/:skillID`、`/accounts` 账号库（锁定/解锁形态由页面自己渲染，守卫只拉元信息）、`/servers` 与 `/servers/:serverID` 服务器监控（独立路由，页面自套 Dashboard 外壳，无解锁态）、`*` 404。
- 布局：`layouts/Dashboard.tsx`（侧边栏 + 可拖拽 ResizablePanel + 主内容区，挂全局 EditItemDialog/SettingsDialog）、`Auth`、`Onboarding`、`Loading`、`NotFound`。
- **模块注册表 `lib/modules.ts`**：书签/Skill/账号库的全部差异（label、noun、字段、排序、路由、文案）集中在此。侧边栏、工具栏、三种布局、分页统一消费 `ModuleConfigType`。**新增模块或改模块行为优先改这里，不要在组件里写 if-else 模块判断**。
- **react-table 列集合 `components/Table/Fields/moduleColumns.tsx`**：三模块共用——固定列（多选 / 标题 / 操作）+ `MODULES[module].fields` 字段列 + 默认隐藏的 `updated_at` 排序数据通道。书签/Skill 的 `ModuleList` 与账号库的 `AccountVaultList` 都从这里取列；账号库字段列定义在 `components/Account/Layouts/AccountTable.tsx`（按字段 key 合并）。
- 状态管理：MobX（`store/mainStore.ts` 数据 + `store/preferencesStore.ts` 偏好 + `store/vaultStore.ts` 账号库 UI 态），`observer` + `StoreContext` 注入。
  **所有 API 调用集中在 mainStore；endpoint 常量在 `store/api.ts`；组件不直接 fetch**。
  账号库数据用独立 observable（`accounts` / `accountGroups` / `accountTotal` / `currentAccount`），与书签/Skill 完全隔离（PRD §5.1.1）。
- 列表页状态与 URL 同步：`page`、`per-page`、`sort`、`order`、`search`、`tag`（`tag=none` 表示未标记），见 `hooks/useUrlState.ts`、`hooks/useItemListState.ts`。
  账号库额外用 `platform` / `group`（见 `hooks/useAccountListState.ts`），**不写 `tag`**（不复用标签体系）。
- 分页每页条数选项 **9 / 24 / 48 / 96，默认 24**，三模块共用（`components/Table/Controls/Pagination.tsx` + `ModuleList.tsx` 的默认值）。
- 样式：Tailwind CSS v4；设计 token 是 `index.css` 中的 CSS 变量（oklch，`:root`/`.dark` 两套）。**禁止写死颜色，一律用语义变量/类**。
- 组件库：`components/ui/` 下 37 个 shadcn 风格原语；业务组件按 `Sidebar/`、`Table/`、`EditItem/`、`Settings/` 分目录；三种布局在 `components/Table/Layouts/`。
  账号库组件在 `components/Account/`：`Layouts/`（`AccountList` / `AccountCards` / `AccountTable` 三布局 + 账号字段列定义）、`VaultToolbar`、`VaultLockScreen`、`AccountVaultList`（列表外壳）、`CredentialRow` / `AccountBadges` / `SecretButtons` 等凭据行小组件。
  服务器监控组件在 `components/Server/`：`ServerListPage` / `ServerToolbar` / `ServerCard` / `ServerEmptyState`（列表页）、`ServerDetailPage`（详情页外壳：30s 轮询 detail + 当前 range 的指标序列，头部「开机时长 / 负载」取序列最新点——detail 接口不含快照；非在线态不停图表，保留断开前历史）、`ServerDetailHeader`（名称 / 分组 / 四态徽章 / 系统信息 + 操作区）、`ServerStatusBadge`、`ServerStatusNotice`（离线 / 暂停 / 等待连接提示条）、`ServerBasicInfoCard`（基本信息 + Agent 版本落后提示，D12，与 app-info 的 installed_version 对比）、`ServerInstallCard`（接入信息卡，D6 选项 b：安装命令模板不含明文 Token，Hub 地址取 `window.location.origin`）、`ServerNoteCard`；弹窗与操作组（task15）：`ServerFormDialog`（添加 / 编辑弹窗：react-hook-form + zod，schema 在组件内，新建成功后**同一弹窗内**切换到安装指引态）、`ServerTokenGuide`（Token 明文 + 含 Token 的一行安装命令 + 一键复制，添加成功态与重置成功态**共用同一组件**，禁止复制第二份）、`ServerResetTokenDialog`（重置 Token：二次确认 → 新 Token 指引）、`ServerDeleteDialog`（删除二次确认，确认后 navigate 回 /servers）；暂停 / 恢复是直接动作无弹窗（`updateServer({ paused })` + toast + 经 detailReloadKey 重拉详情）。Token 安全纪律（D6）：明文只在添加 / 重置成功态出现一次，关闭弹窗即清理内存态，列表 / 详情 / toast 不展示，复制走 `lib/copySecret.ts`（toast 只说「已复制」）；图表区（task13，recharts）：`ServerMetricsSection`（范围切换 1h / 6h / 24h / 30d 默认 6h；range 为页面 state、不做 URL 同步，切换只重拉指标不清 detail）+ `ServerMetricChartCard`（CPU / 内存面积图 --chart-1 / --chart-2、网络 rx/tx 双线 --chart-3 / --chart-4；统计行当前 / 峰值 / 均值按全量序列计算）+ `TrendChart`（recharts 封装）+ `chartTokens.ts`（getComputedStyle 解析 --chart-* 语义色，MutationObserver 跟随主题切换）+ `serverChartData.ts`（纯数据 helper：接口序列 → 图表点 / 统计值 / 120 点抽样）；磁盘 / Docker 区（task14）：`ServerDiskSection`（各挂载点用量条，≥80% 警示 / ≥90% 危险，卡头带挂载点计数）+ `ServerDockerSection`（容器表格 名称 / 状态 / CPU / 内存 / 网络，语义化 table 非 react-table；状态圆点 + 文字，running 绿 / exited 灰 / 过渡态琥珀 / dead 红；空态二分：从未回传「等待首次上报后展示。」vs 曾回传但快照为空「未发现 Docker 容器，或未安装 Docker。」）+ `UsageMeter.tsx`（共享 meter 原语：meterTone 阈值函数 / METER_TONE_CLASS 配色 / diskPct / UsageMeter 细条，ServerCard 指标行与磁盘区共用，禁止再复制一份）。数据来源注意：detail 接口出参只有 server + docker、**不含磁盘**，磁盘取列表项 `store.servers` 的 disks（AppSidebar 进入服务器路由时拉取，进入页面时的快照，不随 30s 轮询刷新）；Docker 取 detail.docker，随轮询自动更新。
  登录页组件在 `components/Auth/`：`LoginIntro`（左侧项目介绍：Logo、slogan、4 条能力点、非安全上下文提示、版本号，PRD O-6；<1024px 隐藏能力点），由 `layouts/Auth.tsx` 两栏外壳以 `intro` prop 承载。
- 表单：react-hook-form + zod（schema 在 `lib/types.ts`）。
- 别名：`@` → `src/`（vite.config.ts + tsconfig）。vite 里另有 `@components`、`@assets`、`@api`、`@utils`，但代码中统一用 `@`。
- 代码风格：prettier（2 空格、单引号、分号、printWidth 120、trailingComma es5、tailwindcss 类名排序插件）+ eslint 9 flat。

### 后端

- 入口链：`public/api/index.php`（定义 `ROOT_DIR` 并加载 autoload）→ `framework/bootstrap.php`（启动 session、时区、中间件链）→ `init.php`（ServiceContainer 绑定 PDO/Repository/TagCreator/ItemCreator）→ `routes.php`（嵌套路由数组：路径 → HTTP 方法 → 控制器类）。
- 路由：`Router` 将嵌套数组拍平为 `path/METHOD`，路径 `rtrim('/')` 后精确匹配；新增端点必须同时写对路径层级与 HTTP 方法。
- 控制器：`controllers/` 一个文件一个端点，实现 `Framework\ControllerInterface`，签名 `__invoke(array $input): ResponseInterface`；可选 `validateInput()` 供框架统一校验。
- 响应：
  - `success($message, $data)` → `{ success: true, message, data }`
  - `data($payload)` → 直接返回 payload（如 `GET /api/items` 返回数组、`GET /api/tags` 返回按 id 的对象）
  - 两种形态并存，改接口前先看对应 controller，不要默认有统一包裹。
  - `GET /api/app-info` 附带 `latest_release`（`name` / `body` / `published_at` / `html_url`，来自 GitHub Releases API 最新 release 的说明 Markdown，与版本号共用 12 小时缓存；GitHub 不可达时为 null，前端降级展示，见 optimization.md O-4）。
- 中间件（`framework/bootstrap.php` 顺序）：CSRF → DatabaseMigrations → Authentication。
  - CSRF：写操作校验 `X-CSRF-TOKEN` 请求头（或 `csrf_token` 字段）；GET 跳过；token 同时写入 `CSRF-TOKEN` cookie。
  - Authentication：`users` 表非空即启用认证，未登录返回 401；`AuthLoginController`、`AppInfoController`（后者供登录页展示版本号，只含公开版本信息，PRD O-6）与 agent 态三个控制器（详见下方「服务器监控」条）跳过；数据库未初始化时跳过。
  - 会话：cookie 名 `link-navigator-session`，有效期 7 天。
- 数据层：`models/Repository.php`（SQLite PDO 查询）、`ItemCreator.php`、`TagCreator.php`。
- **服务器监控**（PRD `docs/prd/server.md`）：五张表 `servers` / `server_metrics` / `server_disks` / `server_docker` / `server_connections`（长连接注册表）；30 天明细清理挂在 `migrate()` 末尾顺带执行（决策 D4，到期直接删除、不建聚合表）。用户态端点：`GET /api/servers`、`POST /api/servers`、`PATCH /api/servers`、`POST /api/servers/delete`、`GET /api/servers/detail`、`GET /api/servers/metrics?server-id=&range=1h|6h|24h|30d`（前三档明细；30d 由 `Repository::getServerMetricsHourly()` 在 SQL 层按小时聚合，AVG/MAX 口径见方法注释，决策 D4 不建聚合表）、`POST /api/servers/token`（重置 Token：旧 Token 立即失效，新明文仅此次返回，响应 no-store）。Token 为 SHA-256 + 每服务器随机盐（`Utils/ServerToken.php`），用户态响应一律不返回哈希与盐（`Utils/ServerPayload.php` 白名单）；安装命令组装与 Hub 地址推导共用 `Utils/ServerInstallCommand.php`（新增与重置两个端点）。agent 态端点已注册并实现：`GET /api/agent/connect`（长轮询接入，单次持有 50s：避开生产镜像 `Dockerfile.build` 的 `max_execution_time=60`，循环内每秒 `flush()` + `connection_aborted()` 自检兑现「断开即离线（秒级）」）、`POST /api/agent/report`（回传快照）、`GET /content/install-agent`（下发安装脚本）——对应 `AgentConnectController` / `AgentReportController` / `InstallAgentController` 三个类，凭 `X-Agent-Token` 认证（`Utils/AgentAuth`，无效 Token 与不存在服务器返回逐字节一致的 401），并已按类名加入 `AuthenticationMiddleware::$skip_auth_routes` 与 `CSRFMiddleware::$skipped_routes`（connect / install-agent 虽是 GET 天然跳过 CSRF，仍显式注册保持名单完整）、`DatabaseMigrations` 的 migrate 跳过名单，以及 `framework/bootstrap.php` 按匹配到的控制器类名跳过 `startSession()`（长轮询每次新建并锁定 session 文件会堵住用户态请求）。连接注册表（`server_connections`，决策 D11）：每 Token 单活跃连接，`server_id` 唯一索引从存储层兜底；新连接注册即删旧行挤占，旧连接在长轮询循环内每秒自检 `isServerConnectionActive()`，发现被顶替即以 `reason=superseded` 结束让 agent 退避重连（防新旧 agent 热循环）；`connection_id` 是 Hub 生成的随机标识、不存 Token 明文；行带 `expires_at`（默认 60s > 持有 50s），`cleanupServerConnections()` 清过期行作为兜底，退出时按 (server_id, connection_id) 精确删除、不会误删挤占者的新行。安装脚本单一事实源为仓库根 `agent/install-agent.sh`：`InstallAgentController` 经 `ROOT_DIR . '/agent/install-agent.sh'` 读取、文本替换 `__HUB_URL__` 占位符注入 Hub 地址后以 `text/x-shellscript` 下发（`--hub-url` / `--token` 参数优先于环境变量兜底；缺失文件 500 + error_log）；镜像内由 `Dockerfile.build` 单文件 `COPY agent/install-agent.sh agent/install-agent.sh` 落到 `/var/www/html/agent/`，与 ROOT_DIR 解析一致（只 COPY 脚本，Go 源码 / go.mod / systemd 模板不进镜像）。CI（`.github/workflows/link-agent-release.yml`）随主版本 tag 产出 `link-agent-linux-amd64` / `link-agent-linux-arm64` 及同名 `.sha256` 上传同一 GitHub Release（D12；脚本在校验文件缺失时拒绝安装）。
- **GitHub 网络访问三档设置（PRD O-5）**：`app_settings` 表（key/value）存 `github_access_mode`（auto/proxy/direct）、`github_proxy_prefix`、`app_update_check`；读取走 `Config::getGithubAccessMode()` / `Config::getGithubProxyPrefix()` / `Config::isAppUpdateCheckEnabled()`（数据库优先，环境变量仅初始默认值，非法值 error_log 后回退直连）。接口 `GET/POST /api/settings/network`、`POST /api/settings/network/test`（只做 HEAD 探测）。`GitHelper` 的 clone/fetch 按档位执行：direct 直连、proxy 始终加 `git -c url.<前缀>.insteadOf=...`、auto 先短超时（10s）直连失败再走代理；代理只改写 `github.com` / `codeload.github.com` 两类原始地址，`.git/config` 与 `source_url` 始终是原始地址。
- **数据库迁移**：`DatabaseMigrations` 中间件每次请求调用 `Repository::migrate()`，做幂等的建表/建索引/删除旧列（如 `items.image`）。改表结构时：新库走 `setupDatabase()`，老库在 `migrate()` 里补增量逻辑，必须可重复执行并兼容已有数据库。
- **标签按模块隔离**（PRD O-9）：`tags` 表有 `module` 列（`bookmarks` / `skills`，默认 `bookmarks`），唯一索引为 `(module, title, parent)`（`idx_tags_module_title_parent`，取代旧 `idx_tags_title_parent`）；标签接口按模块过滤，账号库不接入 `tags`。
- 错误码：**仅 Skill 相关接口与 `utils/Skill*`、`GitHelper` 使用 `[SL-XXX-NNNN]` 形式的错误码**（如 `SL-SKL-0005`、`SL-SEC-0003`）；其他接口返回普通中英文 message。JSON 请求异常统一返回 `{ success: false, message, error }`，HTTP 状态码取自异常 code。「JSON 请求异常」含框架 `getInput()` 对**非对象 JSON 请求体**（数字 / 字符串 / null）的统一 400：`array_merge` 抛出的 TypeError 继承 `Error` 而非 `Exception`，`run()` 的 `catch (Exception)` 捕获不到，必须在框架层显式拦截，否则会以 500 HTML 暴露（影响全部 JSON 端点，含 agent 回传）。
- Skill 文件：安装在 `storage/skills/`，GitHub 来源保留 `.git` 用于检查更新；上传仅 `.zip`，同名覆盖。
- `views/` 仅保留服务端错误页：`views/layouts/primary.php`、`views/pages/error.php`；正常 UI 100% 在前端。
- PHP 代码用 **tab 缩进**（与前端 2 空格不同，各随其便）。

### 被监控端 agent（`agent/`，Go）

- `agent/` 是仓库内独立 Go module（模块名 `github.com/super-mortal/super-link/agent`，`go.mod` 声明 `go 1.23` 保守下限），**零第三方依赖**：采集全部走标准库（`/proc`、`net/http`、`encoding/json`），Docker 采集直连 Docker Engine API（Unix socket），不用 SDK、不用 `docker stats` CLI（决策 D2）；采集器不写 `//go:build linux`，Windows 开发机上 `go vet` / `go test` / 交叉编译均可通过（决策 D8 只部署 Linux）。
- 构建：本地 `go build -o link-agent .`；交叉编译 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64|arm64 go build -ldflags "-X main.version=<tag>" -o link-agent-linux-<arch> .`（版本经 ldflags 注入，未注入为 `dev`；Hub 详情页据此做落后提示，D12）。提交前门槛：`gofmt -l . && go vet ./... && go test ./...`。CI 见 `.github/workflows/link-agent-release.yml`（在 `agent/` 目录内构建，仓库根无 go.mod）。
- 长轮询协议基准在 `controllers/AgentConnectController.php` 与 `AgentReportController.php` 文件头注释，agent 侧对应 `main.go` 的 `connectOnce` / `collectAndReport` 与 `protocol.go`：connect 建连（Token 只走 `X-Agent-Token` 头）→ 逐行读 ndjson（保活空行跳过）→ `collect` 指令触发全量采集并经 POST report 回传 → 结束行按语义行动（reconnect 立即重连 / superseded 退避；401 停止重连、403 暂停退避）。
- `agent/install-agent.sh` 是三处落位的同一份文件：仓库根单一事实源、Hub `/content/install-agent` 内容路由下发（镜像内经 `Dockerfile.build` COPY 到 `/var/www/html/agent/`）、CI 产物命名以它为准；`agent/link-agent.service` 与脚本内嵌 unit 逐字节一致，改一边必须改另一边。目录结构 / 配置键 / 安装流程详见 `agent/README.md`。

## 常见任务

- **新增 API**：`routes.php` 注册 → `controllers/` 新建控制器 → `store/api.ts` 加 endpoint → `mainStore` 加方法；确认响应 envelope 与前端调用方一致。
- **新增前端模块**：`lib/modules.ts` 增加配置并加入 `MODULE_KEYS`；侧栏图标在 `components/Sidebar/ModuleSwitcher.tsx`；数据加载与 API 方法补在 `mainStore`；后端补路由/控制器/存储。
  账号库这类「独立路由 + 需解锁」的模块：侧栏点击走 `navigate` 而不是 `store.setModule`（不过 `ModuleList`，由 `components/Account/AccountVaultList.tsx` 自建列表外壳），侧栏分区按路由切换（`AppSidebar` 里 `isAccountsRoute` 决定渲染 `NavTags` 还是 `NavPlatforms`）。
  账号库列表外壳复用 `Table/Controls` 的视图 / 搜索 / 排序 / 分页 / 批量条与 `moduleColumns.tsx` 列集合，但搜索 / 平台 / 分组 / 排序走服务端（`fetchAccounts` 带参，密文字段不可搜），分页仍在前端（后端返回全量过滤结果）；锁定态不渲染列表。
  服务器监控（决策 D5）是同类「独立路由」参照，但**不进模块注册表**（无 `ModuleConfigType`）：侧栏入口是 `ModuleSwitcher` 里 `MODULE_KEYS.map` 之外的独立行（点击 `navigate('/servers')`，高亮按 `location.pathname.startsWith('/servers')` 判定；服务器路由下三个模块行均不高亮，点模块行会 `navigate('/')` 回列表——只 `setModule` 不跳转会导致页面无反应）；侧栏分区由 `AppSidebar` 按路由切换为分组筛选（`AppSidebar.tsx` 内 `NavServerGroups`：固定四项 `SERVER_GROUPS` + 后端 `store.serverGroups` 计数，为 0 也展示，无「全部」行，再点取消）；选中分组存 `store.serverListParams.group`，点击即 `fetchServers` 重拉，task11 列表页直接消费；进入服务器路由时由 `AppSidebar` 统一拉一次列表（分组计数同源）；列表 / 详情页在 `components/Server/` 自建外壳（不过 `ModuleList`，无解锁态）。
- **改模块文案/字段**：只改 `lib/modules.ts`；表格列、字段勾选、卡片/列表门控都由它派生。
- **改排序**：同时改 `lib/modules.ts` 的 `sorts` 与后端控制器里的排序映射（如 `SkillsGetController::SORTS`）。
- **改表结构**：`Repository::setupDatabase()` + `Repository::migrate()` 双写，保证新库与老库都能升级。
- **改上传限制**：前端 `InstallSkillDialog` 的 `MAX_ARCHIVE_SIZE`（当前 32MB）与服务端上限保持一致。

## 约定与注意事项

- 注释与面向用户的文案用**中文**；用户提示统一 sonner toast。
- **能复用的 UI 必须组件化**：页面组件只做组合，不堆叠大段 JSX；重复出现的行、按钮、弹窗、徽章抽成组件或纯函数，禁止复制粘贴。
- 新增或修改非显而易见的逻辑时补中文注释，说明原因、边界条件与安全注意事项，不要逐行翻译代码。
- 未经用户明确许可不得 `git push` 或任何远程写操作。
- 后端接口变更注意兼容：前后端可能不是同一版本，接口语义变化要在注释里说明。
- 新增/修改 UI 时保持暗色主题可用，禁止硬编码亮色。
- Skill 上传上限 32MB：前端常量与服务端限制保持同步，改动需两边一起改。
- **截图验证产物必须清理**：任务过程中产生的截图、录屏、临时 HTML、浏览器 profile、比对脚本等只用于过程校验，任务结束前必须全部删除，不得留在仓库或系统临时目录；提交前用 `git status` 确认没有残留。

## 不要提交

`.gitignore` 已配置以下内容，保持不入库：

- `storage/`（仅 `.gitignore` 例外）、`.env` / `.env.*`
- `vendor/`、`.idea/`、`.DS_Store`、日志与临时文件
- `mockups/`（本地纯 HTML 原型与演示，不属于产品代码）
- `.super-agent/`、`.workbuddy/`（本地协同/记忆工作区）
- 前端 `node_modules/`、`dist/`、`*.tsbuildinfo`、`public/dist/`

`AGENTS.md` 已纳入仓库，修改后随对应变更一起提交。
