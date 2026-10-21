# super-link Skill 模块实施方案

> UI 基准：`mockups/skill-module-demo.html`（交互演示稿）。本文档定义 Skill 模块与侧边栏模块化改造的完整实现方案。



---

## 1. 范围

### 1.1 本期实现

- **Skill 模块**：Agent Skills 开放格式（skill = 含 SKILL.md 的文件夹），支持两种安装来源：
  - GitHub 仓库安装（保留 .git，支持更新检测）
  - 压缩包上传（.zip，解压即用）
- **侧边栏模块化改造**：书签 / Skill 双模块切换，两模块共用：标签体系、统一卡片组件、工具栏、分页、批量操作
- **Skill 管理能力**：列表（卡片/列表/表格三种布局）、详情（SKILL.md 渲染）、标签、更新检测与执行、导出、删除、批量操作

### 1.2 架构预留（本期不实现）

- **密码模块**：按 MODULES 注册模式追加——新表 + 控制器组 + 前端页面，侧边栏/工具栏/卡片自动适配
- **浏览器扩展**：独立项目，消费同一套 API

### 1.3 技术栈（不变）

| 层  | 选型                                                          |
| -- | ----------------------------------------------------------- |
| 后端 | PHP 8.4 + SQLite + 自研微框架（Router / ServiceContainer / 中间件管道） |
| 前端 | React 19 + TypeScript + MobX + Tailwind 4 + Radix UI        |
| 部署 | Docker Compose 单容器（Apache + PHP）                            |

不引入 PostgreSQL、不引入 Composer 新依赖（frontmatter 解析手写）。

---

## 2. 数据模型

### 2.1 新增表

```sql
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,            -- 'github' | 'upload'
  source_url TEXT NOT NULL DEFAULT '',  -- github 来源的仓库地址；上传为空
  fingerprint TEXT NOT NULL DEFAULT '', -- github=commit SHA；upload=SKILL.md 内容 sha256
  installed_at TEXT DEFAULT(NULL),
  updated_at TEXT DEFAULT(NULL)
);

CREATE TABLE IF NOT EXISTS skills_tags (
  skill_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY(skill_id, tag_id)
  FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

### 2.2 复用结构

- **tags 表两模块共用**，不新建标签表；skill 的分类/标签即书签的标签
- `skills_tags` 与 `items_tags` 结构完全同构（含级联删除）

### 2.3 文件存储布局

```
storage/
  skills/
    <name>/                 # skill 文件夹本体（name 即表内 name）
      SKILL.md              # 必需：元数据 + 指令
      scripts/  references/  assets/   # 可选
      .git/                 # 仅 GitHub 来源保留，用于更新检测
```

- 路径由 `Config::getSkillsStoragePath()` 提供：`storage/skills/`
- skill 目录名 = 数据库 name（唯一约束保证不冲突）

---

## 3. 后端实现

### 3.1 镜像依赖

`Dockerfile.build` 增加 `git`：

```
apt-get install -y git
```

git 仅用于 skill 安装与更新检测（clone / fetch / rev-parse），运行时零常驻成本。

### 3.2 配置扩展（Config.php）

```php
public static function getSkillsStoragePath(): string  // storage/skills/
```

上传大小上限沿用 php.ini 现有 `upload_max_filesize = 32M`，不新增配置。

### 3.3 路由（routes.php，沿用现有嵌套数组风格）

| 方法    | 路径                          | 控制器                          | 说明                         |
| ----- | --------------------------- | ---------------------------- | -------------------------- |
| GET   | `/api/skills`               | SkillsGetController          | 列表（含标签 id 数组）              |
| POST  | `/api/skills/install`       | SkillsInstallController      | GitHub 安装，入参 `{url}`       |
| POST  | `/api/skills/upload`        | SkillsUploadController       | 压缩包上传（multipart）           |
| GET   | `/api/skills/detail`        | SkillsDetailController       | 详情：元数据 + SKILL.md 原文 + 文件树 |
| POST  | `/api/skills/delete`        | SkillsDeleteController       | 删除（同步删目录）                  |
| PATCH | `/api/skills/tags`          | SkillsTagsUpdateController   | 设置标签，入参 `{id, tags[]}`     |
| POST  | `/api/skills/check-updates` | SkillsCheckUpdatesController | 批量检查，返回有更新列表               |
| POST  | `/api/skills/update`        | SkillsUpdateController       | 执行更新，入参 `{id}`             |
| GET   | `/api/skills/export`        | SkillsExportController       | 导出 zip 下载                  |

### 3.4 控制器职责

- **SkillsGetController**：查 skills + skills_tags，组装 `{...skill, tags: [id...]}`；支持 `search` / `tag` / `sort` / `page` 查询参数（与书签列表一致）
- **SkillsInstallController**：校验 URL → 调 SkillInstaller → 返回新 skill 对象
- **SkillsUploadController**：接收 zip → 安全校验 → 解压 → 返回新 skill 对象
- **SkillsDetailController**：读 SKILL.md 原文（前端渲染）+ 扫描目录生成文件树（目录带文件计数）
- **SkillsDeleteController**：删 DB 行 + 递归删 `storage/skills/<name>/`
- **SkillsTagsUpdateController**：全量替换 skills_tags 关联（照抄 ItemsTagsUpdateController 逻辑）
- **SkillsCheckUpdatesController**：遍历 github 来源 → fetch → 比对 HEAD 与 fingerprint → 返回 `[{id, name, current, latest}]`
- **SkillsUpdateController**：git pull → 更新 fingerprint / updated_at → 重新解析 frontmatter 刷新 description
- **SkillsExportController**：将 skill 目录打包为 zip 输出（排除 .git）

### 3.5 核心服务（utils/ 或 models/，照现有 Creator 风格）

**SkillInstaller**（安装流程编排）

```
installFromGithub(url):
  1. 规范化 URL（支持 owner/repo 简写与完整 https 地址；子目录链接取末段为 name）
  2. 校验 name 不与已有 skill 冲突
  3. git clone --depth 1 <url> storage/skills/<name>（URL 经 escapeshellarg）
  4. 定位 SKILL.md：根目录 → ./skills/<name>/ → 任意一级子目录
  5. 解析 frontmatter 取 name/description（目录名优先，frontmatter name 作为校验）
  6. fingerprint = git rev-parse HEAD
  7. 写 DB，返回 skill 对象

installFromUpload(zip):
  1. 校验扩展名 .zip、大小 ≤ 32MB
  2. 逐条目校验路径（安全规则见 §6）
  3. 解压到 storage/skills/<name>/（name 取压缩包根目录名或 SKILL.md 所在目录名）
  4. 定位并解析 SKILL.md
  5. fingerprint = sha256(SKILL.md 内容)
  6. 写 DB，返回 skill 对象
```

**SkillFrontmatter**（手写简易解析器，不引依赖）

- 输入 SKILL.md 原文，提取 `---` 之间的 YAML 头
- 仅解析 `name` 与 `description` 两个字段（去引号、截断超长）
- 解析失败不阻塞安装（description 回落为空，前端提示）

**GitHelper**（exec 封装）

- `cloneDepth1(url, dest)` / `head(dest)` / `fetch(dest)` / `pull(dest)`
- 所有外部输入经 `escapeshellarg()`；设置超时（clone 60s / fetch 20s）

**SkillExporter**

- ZipArchive 打包 skill 目录（排除 .git），流式输出

### 3.6 数据库迁移

沿用现有**运行时迁移模式**（DatabaseMigrations 中间件每请求执行）：在 `Repository::migrate()` 中追加 skills / skills_tags 的 `CREATE TABLE IF NOT EXISTS`，与 users 表迁移同款写法。无需独立迁移工具。

### 3.7 API 响应格式

沿用现有 `data()` / `success()` 结构。关键响应：

```json
// GET /api/skills
{ "success": true, "data": { "skills": [
  { "id": 1, "name": "pdf-tool", "description": "...", "source_type": "github",
    "source_url": "github.com/demo/pdf-tool", "fingerprint": "a1b2c3d",
    "installed_at": "2026-10-18 21:04", "updated_at": "...", "tags": [1, 2, 3] }
] } }

// GET /api/skills/detail?id=1
{ "success": true, "data": {
  "skill": { ...同上 },
  "content": "# PDF 解析工具\n...",
  "files": [ {"name": "SKILL.md", "type": "file"},
             {"name": "scripts/", "type": "dir", "count": 3} ]
} }

// POST /api/skills/check-updates
{ "success": true, "data": { "updates": [
  { "id": 1, "name": "pdf-tool", "current": "a1b2c3d", "latest": "f6e5d4c" }
] } }
```

---

## 4. 前端实现

### 4.1 模块注册表（MODULES 配置）

新增 `src/lib/modules.ts`，作为双模块（及未来密码模块）的唯一配置源：

```ts
export const MODULES = {
  bookmarks: {
    label: '书签', noun: '项目',
    titleOf: i => i.title, dateOf: i => i.createdAt, updatedOf: i => i.updatedAt,
    dateLabel: '创建时间',
    fields: [ {key:'url',label:'链接'}, {key:'tags',label:'标签'},
              {key:'desc',label:'描述'}, {key:'date',label:'创建时间'} ],
    sorts: [ created-desc / created-asc / title-asc / title-desc / updated-desc ],
  },
  skills: {
    label: 'Skill', noun: 'Skill',
    titleOf: i => i.name, dateOf: i => i.installedAt, updatedOf: i => i.updatedAt,
    dateLabel: '安装时间',
    fields: [ {key:'desc',label:'描述'}, {key:'tags',label:'标签'},
              {key:'date',label:'安装时间'}, {key:'sha',label:'指纹'} ],
    sorts: [ installed-desc / installed-asc / name-asc / name-desc / updated-desc ],
  },
};
```

侧边栏切换器、动态分区、工具栏（排序/字段/按钮）、卡片字段渲染全部由该配置驱动。**新增模块 = 配置追加一项 + 新表 + 控制器组 + 详情页**，框架代码零改动。

### 4.2 侧边栏改造

| 组件                              | 变更                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `Sidebar/ModuleSwitcher.tsx`（新） | 竖排模块导航（书签 / Skill），带数量徽章；点当前模块 = 清除标签筛选                                      |
| `Sidebar/NavMain.tsx`           | 移除（「所有项目 / 未标记」入口取消，筛选由标签树 + 模块切换器承担）                                        |
| `Sidebar/NavTags.tsx`           | 保留，标签树样式对齐演示稿：父标签折叠箭头 + 子列表左边线缩进、右侧计数徽章（悬停让位给 ⋯ 菜单）、选中深色 pill、悬停 ⋯（编辑/置顶/删除） |
| 分区标签                            | 书签模块显示「标签」，Skill 模块显示「分类」                                                    |
| 头部 / 底部                         | Logo + 明暗切换 + 设置（头部右侧）、用户区（底部）不变                                             |

### 4.3 工具栏模块化

`ItemList.tsx` 重构为 `ModuleList.tsx`，由 `state.module` 驱动：

- **视图下拉**：布局三选（卡片/列表/表格）+ 可见字段勾选（字段清单来自 MODULES.fields）
- **搜索**：`flex-1` 撑满，匹配标题/链接/描述/标签名
- **排序下拉**：选项与标签来自 MODULES.sorts
- **右侧按钮**：书签模块「添加」，Skill 模块「安装 Skill」（打开安装弹窗）

### 4.4 统一卡片组件（书签与 Skill 共用）

`Table/Layouts/CardsLayout.tsx` 重构为配置驱动，单卡片结构（位置固定，不随内容塌缩）：

```
┌─────────────────────────────────────┐
│ [☐ 左上角多选]                       │
│ 标题 + 徽章              [展开][⋯] │  ← 右上角双按钮，悬停浮现，绝对定位
│ 链接/来源行（书签=链接；Skill=来源）  │
│ 描述（限两行，固定占位 min-h）        │
│ 标签徽章（加重样式：色底+描边）       │
│ ─────────────────────────────────── │
│ 左下: 指纹(Skill)/创建时间(书签)      │
 │ 右下: 安装时间(Skill)/修改时间(书签) │
└─────────────────────────────────────┘
```

- 渐变底 + 细边框 + 悬停阴影；选中态 `bg-muted/50`
- 徽章：Skill 显示来源（GitHub/上传）+ 有更新标；书签无徽章
- 展开按钮：Skill 进详情，书签进编辑；⋯ 菜单分模块（Skill：详情/检查更新/导出/删除；书签：编辑/复制链接/删除）
- 复选框：悬停浮现，选中常驻；多选时底部出批量操作 pill

### 4.5 三种布局

- **卡片**：响应式网格（1/2/3/4 列）
- **列表**：`divide-y` 横线分隔，行内距 `px-8 py-6`，字段竖排（标题→来源→标签→描述→时间），复选框左侧垂直居中，操作右上角绝对定位
- **表格**：名称/来源/标签/指纹/时间列 + 操作列

### 4.6 分页（对齐实际应用）

```
共 N 条项目
每页[项目]数 [10▾]      第 X 页，共 Y 页  [⏮][◀][▶][⏭]
```

- 每页数 10/25/50/100，默认 25；翻页滚动回顶；筛选/搜索/排序变化时重置到第 1 页

### 4.7 Skill 详情页（`pages/SkillDetail.tsx`，新）

- 头部：返回 + 名称 + 来源徽章 + 有更新标 + 描述 + 操作按钮（检查更新 / 更新到最新 / 导出 / 删除，均带加载态）
- 左栏：SKILL.md 只读渲染（markdown → HTML，代码块深色底）
- 右栏：
  - 基本信息：来源 / 指纹（mono）/ 安装时间 / 最近检查
  - 标签：可删徽章 + 「添加标签」弹窗——顶部输入框回车即添加（匹配现有标签或自动创建并随机配色），下方现有标签点选
  - 文件：目录树（目录带文件计数，点击 toast 预览）

### 4.8 安装弹窗（`components/InstallSkillDialog.tsx`，新）

- 两个 tab：**从 GitHub 安装**（URL 输入 + 三条提示：支持根目录/skills 子目录/任意一级子目录的 SKILL.md；保留 .git 可检测更新；支持子目录链接）/ **上传压缩包**（拖拽区 + 约束提示：需含 SKILL.md、≤32MB、同名覆盖）
- 安装流程：按钮加载态（转圈 + 「安装中…」）→ 成功关弹窗 + 新卡片高亮动画 + toast

### 4.9 批量操作 pill（对齐实际应用）

- 底部居中深色悬浮条（`bg-primary`），随侧边栏开合偏移居中
- 内容：全选/半选方块图标 + 「N 已选择」/ 标签 / 刷新 / 删除 / 关闭
- 取消勾选最后一项、点关闭、删除后均即时消失

### 4.10 状态管理（MobX store 扩展）

现有 store 增加 skills 相关状态与方法：

```
skills: SkillType[]
fetchSkills() / installSkill(url) / uploadSkill(file) / deleteSkill(id)
updateSkillTags(id, tags) / checkSkillUpdates() / updateSkill(id) / exportSkill(id)
fetchSkillDetail(id)
```

模块切换状态 `module: 'bookmarks' | 'skills'` 入 store；标签筛选 `tagFilter` 两模块共用。

---

## 5. 安装与更新流程

### 5.1 GitHub 安装

```
输入 URL → 规范化（简写补全为 https://github.com/...）
→ 名称冲突检查 → git clone --depth 1（60s 超时）
→ 定位 SKILL.md（根 → skills/<name>/ → 一级子目录）
→ 解析 frontmatter → fingerprint = rev-parse HEAD
→ 写 skills + skills_tags → 返回对象
```

### 5.2 上传安装

```
接收 .zip（≤32MB）→ 逐条目路径校验（§6）
→ 解压到 storage/skills/<name>/ → 定位并解析 SKILL.md
→ fingerprint = sha256(SKILL.md 内容) → 写库 → 返回对象
```

### 5.3 更新检测与执行

```
检测：遍历 source_type=github 的 skills → git fetch（20s 超时）
     → rev-parse HEAD ≠ fingerprint → 列入 updates
执行：git pull → fingerprint/updated_at 更新 → 重新解析 frontmatter 刷新 description
上传来源：无上游，不参与检测（重复上传即覆盖）
```

---

## 6. 安全规则


| # | 规则 |
|---|---|
| 1 | **zip-slip 防护**：解压逐条目校验，拒绝含 `..` 路径段、绝对路径、盘符的条目 |
| 2 | 上传仅接受 `.zip`，大小 ≤ 32MB |
| 3 | skill 必须含 SKILL.md（根目录或一级子目录），否则拒绝安装 |
| 4 | git URL 仅允许 https（github.com 域名或 owner/repo 简写），所有外部输入经 `escapeshellarg()` |
| 5 | skill 名称唯一（DB UNIQUE + 目录存在性双重检查），冲突拒绝 |
| 6 | 删除 skill 同步递归删除目录，防残留 |
| 7 | SKILL.md 是指令文件（给 AI 读）：详情页只读渲染、不执行；skill 内脚本的供应链风险靠指纹（commit SHA）锁定告知用户 |
| 8 | 导出排除 .git 目录 |

---

## 7. 交付顺序

| 阶段 | 内容 | 产出 |
|---|---|---|
| 1 | 后端基础：skills/skills_tags 建表入 migrate()、Config 路径、Dockerfile 加 git | 表就绪 |
| 2 | 后端 API：安装（GitHub/上传）+ 列表 + 详情 + 删除 + 标签 | 可用 API |
| 3 | 前端骨架：MODULES 配置、ModuleSwitcher、侧边栏动态分区、工具栏模块化 | 双模块切换可用 |
| 4 | 前端列表：统一卡片 + 三布局 + 分页 + 搜索/排序/筛选 + 批量操作 | Skill 列表完成 |
| 5 | 前端详情：SKILL.md 渲染 + 标签弹窗内联添加 + 文件树 + 操作按钮 | Skill 管理完成 |
| 6 | 完善：更新检测/执行、导出 zip | 功能闭环 |
| 7 | 预留验证：按 MODULES 模式演练密码模块追加路径（不实现） | 扩展性确认 |

每阶段完成后可独立验证；阶段 3 起书签模块同步切换到新框架（模块切换器 + 统一卡片）。
