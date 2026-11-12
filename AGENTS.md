# AGENTS.md

本文件为 AI 编码代理提供**开发阶段**的项目指南。修改代码前先读本文件。部署、发布与运维相关内容不在这里，见 README.md。

> **本文件的维护**：项目相关变更（架构、命令、目录结构、约定等）发生时，代理必须同步更新本文件，无需事先征求同意；任务结束时向用户报告"更新了 AGENTS.md"及具体更新点。

## 项目概览

super-link 是自托管的个人数据管理工具，从书签管理起步，通过模块机制扩展（当前：书签、Skill、账号库）。数据完全由用户自持。

- 前端：React 19 + TypeScript 5.8 + Vite 7 SPA（`frontend/`）
- 后端：PHP 8.4 + Apache，纯 JSON REST API（无服务端渲染 UI）
- 数据库：SQLite（默认 `storage/link_navigator.db`）
- 文档：产品需求文档放在 `docs/prd/`；账号库见 [docs/prd/account-vault.md](docs/prd/account-vault.md)，优化项见 [docs/prd/optimization.md](docs/prd/optimization.md)；本地 HTML 高保真交互原型在 `mockups/`（不随仓库提交）

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
- 可用环境变量：`DB_NAME`（默认 `link_navigator`）。

## 本地开发环境

- 前端 dev server 把 `/api`、`/content` 代理到 `http://host.docker.internal:$BACKEND_PORT`（默认 `8000`）。
  若本机无法解析该主机名，需要在 hosts 中指向本机，或临时把代理目标改为 `127.0.0.1`。
- 主题默认 `system`，localStorage key 为 `faved-ui-theme`（历史命名，勿随意改）。
- 布局偏好：`layout`（list/cards/table）、`column-visibility-<module>-<layout>`、`app:preferences`。
- 侧栏拖拽布局由 `react-resizable-panels` 持久化，`useDefaultLayout({ id: 'dashboard-layout' })`。

## 架构要点

### 前端（`frontend/src/`）

- 入口 `main.tsx` → `App.tsx`（react-router-dom 路由表），全局唯一样式 `index.css`。
- 路由：`/` 列表、`/login`、`/setup` 及三步引导、`/create-item`、`/edit-item/:itemID`、`/skills/:skillID`、`/accounts` 账号库（锁定/解锁形态由页面自己渲染，守卫只拉元信息）、`*` 404。
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
  - Authentication：`users` 表非空即启用认证，未登录返回 401；`AuthLoginController` 与 `AppInfoController` 跳过（后者供登录页展示版本号，只含公开版本信息，PRD O-6）；数据库未初始化时跳过。
  - 会话：cookie 名 `link-navigator-session`，有效期 7 天。
- 数据层：`models/Repository.php`（SQLite PDO 查询）、`ItemCreator.php`、`TagCreator.php`。
- **数据库迁移**：`DatabaseMigrations` 中间件每次请求调用 `Repository::migrate()`，做幂等的建表/建索引/删除旧列（如 `items.image`）。改表结构时：新库走 `setupDatabase()`，老库在 `migrate()` 里补增量逻辑，必须可重复执行并兼容已有数据库。
- **标签按模块隔离**（PRD O-9）：`tags` 表有 `module` 列（`bookmarks` / `skills`，默认 `bookmarks`），唯一索引为 `(module, title, parent)`（`idx_tags_module_title_parent`，取代旧 `idx_tags_title_parent`）；标签接口按模块过滤，账号库不接入 `tags`。
- 错误码：**仅 Skill 相关接口与 `utils/Skill*`、`GitHelper` 使用 `[SL-XXX-NNNN]` 形式的错误码**（如 `SL-SKL-0005`、`SL-SEC-0003`）；其他接口返回普通中英文 message。JSON 请求异常统一返回 `{ success: false, message, error }`，HTTP 状态码取自异常 code。
- Skill 文件：安装在 `storage/skills/`，GitHub 来源保留 `.git` 用于检查更新；上传仅 `.zip`，同名覆盖。
- `views/` 仅保留服务端错误页：`views/layouts/primary.php`、`views/pages/error.php`；正常 UI 100% 在前端。
- PHP 代码用 **tab 缩进**（与前端 2 空格不同，各随其便）。

## 常见任务

- **新增 API**：`routes.php` 注册 → `controllers/` 新建控制器 → `store/api.ts` 加 endpoint → `mainStore` 加方法；确认响应 envelope 与前端调用方一致。
- **新增前端模块**：`lib/modules.ts` 增加配置并加入 `MODULE_KEYS`；侧栏图标在 `components/Sidebar/ModuleSwitcher.tsx`；数据加载与 API 方法补在 `mainStore`；后端补路由/控制器/存储。
  账号库这类「独立路由 + 需解锁」的模块：侧栏点击走 `navigate` 而不是 `store.setModule`（不过 `ModuleList`，由 `components/Account/AccountVaultList.tsx` 自建列表外壳），侧栏分区按路由切换（`AppSidebar` 里 `isAccountsRoute` 决定渲染 `NavTags` 还是 `NavPlatforms`）。
  账号库列表外壳复用 `Table/Controls` 的视图 / 搜索 / 排序 / 分页 / 批量条与 `moduleColumns.tsx` 列集合，但搜索 / 平台 / 分组 / 排序走服务端（`fetchAccounts` 带参，密文字段不可搜），分页仍在前端（后端返回全量过滤结果）；锁定态不渲染列表。
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
