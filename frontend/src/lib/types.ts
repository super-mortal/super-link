import z from 'zod';

export type CreateUserType = {
  username: string;
  password: string;
  confirm_password: string;
};

export type LoginType = {
  username: string;
  password: string;
};

export type UpdateUsernameType = {
  username: string;
};

export type UserType = {
  id: number;
  username: string;
};

export type UpdatePasswordType = {
  password: string;
  confirm_password: string;
};

export const UrlSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL is required' })
  .transform((val) => (val.includes(':') ? val : `https://${val}`))
  .pipe(z.url());

export const ItemSchema = z.object({
  id: z.any().optional(),
  title: z.string().min(1, { message: 'Title is required' }),
  url: UrlSchema,
  description: z.string().optional(),
  comments: z.string().optional(),
  tags: z.array(z.any()).optional(),
  created_at: z.any().optional(),
  updated_at: z.any().optional(),
});

export type ItemType = z.infer<typeof ItemSchema>;

export type TagType = {
  id: number;
  parent: number;
  title: string;
  description?: string;
  color: string;
  pinned: boolean;
  created_at: string;
  updated_at: string | null;
  fullPath: string;
  fullPathIDs: string;
};
export type TagsObjectType = Record<number, TagType>;

export type LayoutType = 'table' | 'cards' | 'list';

export type TagFilterType = number | 'none' | null;

export type ModuleKey = 'bookmarks' | 'skills' | 'accounts';

export type SkillSourceType = 'github' | 'upload';

export type SkillType = {
  id: number;
  name: string;
  description: string;
  source_type: SkillSourceType;
  source_url: string;
  fingerprint: string;
  installed_at: string;
  updated_at: string | null;
  tags: number[];
  /** 前端态：check-updates 返回有更新时标记，不落库 */
  hasUpdate?: boolean;
  /** 前端态：刚安装完成，卡片高亮 2s 后清除，不落库 */
  justInstalled?: boolean;
};

export type SkillFileType = {
  name: string;
  type: 'file' | 'dir';
  count?: number;
};

export type SkillDetailType = {
  skill: SkillType;
  content: string;
  files: SkillFileType[];
};

/** check-updates 返回的有更新项 */
export type SkillUpdateType = {
  id: number;
  name: string;
  current: string;
  latest: string;
};

/**
 * Skill 安装任务状态（refinements-v0.1.2 §4.4 方案 B）。
 * 与后端 Utils\SkillInstallTaskPayload::format() 一一对应：后端在「建任务 + 异步 worker」
 * 模式下立刻返回任务对象，前端按 id 轮询 GET /api/skills/install/status?task-id= 取真实阶段。
 */
export type SkillInstallTaskStatusType = 'pending' | 'running' | 'success' | 'failed';

export type SkillInstallTaskType = {
  id: number;
  /** 由来源地址推导出的 Skill 名（失败摘要 / 进度展示用） */
  skill_name: string;
  source_url: string;
  status: SkillInstallTaskStatusType;
  /** 当前阶段文案（worker 写入），失败时停在失败阶段 */
  stage: string;
  /** 错误摘要或完成说明，可能为空串 */
  message: string;
  created_at: string | null;
  updated_at: string | null;
  /** 已用时长（秒）：进行中实时计算，结束后固定为创建工作到最后更新的差值 */
  elapsed_seconds: number;
  /** 任务成功时后端附带的 Skill 对象（与 GET /api/skills 同形）；Skill 已被删除时为 undefined */
  skill?: SkillType;
};

/* ---------------------------------------------------------------------------
 * 待办（PRD docs/prd/todo.md §6.2 / §6.3）
 * 与后端 Utils\TodoPayload::formatTodo() 白名单出参一一对应：done 为布尔（库内 0/1），
 * done_at 未完成时为 null，三个时间列都是服务端生成的 'Y-m-d H:i:s' 字符串。
 * ------------------------------------------------------------------------- */

export type TodoType = {
  id: number;
  text: string;
  done: boolean;
  created_at: string;
  /** 完成时间：done=false 时为 null（PATCH 取消完成会由服务端置回 NULL） */
  done_at: string | null;
  /** 后端出参同样带该列，前端只做透传，不参与展示与排序 */
  updated_at: string | null;
};

/* ---------------------------------------------------------------------------
 * 账号库（PRD docs/prd/account-vault.md §6 / §8）
 * 说明：所有密文字段以 Base64 字符串在前后端间传输，落库为 BLOB；
 * 前端解密后仅驻留内存，绝不写入 localStorage / sessionStorage / MobX observable。
 * ------------------------------------------------------------------------- */

/** KDF 算法标识：浏览器无原生 Argon2，首版固定降级为 pbkdf2-sha256（见 vaultCrypto.ts 文件头） */
export type VaultKdfAlgorithmType = 'argon2id' | 'pbkdf2-sha256';

/** 单字段密文：ct 为密文、iv 为 12 字节 nonce，均为 Base64 */
export type VaultSecretField = {
  ct: string;
  iv: string;
};

/** 加密字段名，与 AAD 的 field 段一致 */
export type VaultSecretFieldName = 'password' | 'totp' | 'notes';

/** TOTP 明文载荷（`totp_ct` 解密后得到的就是这段 JSON） */
export type TotpPayloadType = {
  secret: string;
  issuer?: string;
  account?: string;
};

/** KDF 参数：与 vault_meta 的 kdf / kdf_* 列对应，具体取值见 vaultConstants.ts */
export type VaultKdfParamsType = {
  algorithm: VaultKdfAlgorithmType;
  /** PBKDF2 迭代次数（≥ 600000）；argon2id 时无意义 */
  iterations: number;
  /** 摘要算法，PBKDF2-HMAC-SHA256 固定为 SHA-256 */
  hash: 'SHA-256';
  /** 盐长度（字节），仅用于本地生成盐时参考，不参与派生计算 */
  saltBytes?: number;
  /** Argon2id 的内存开销（KiB），降级 PBKDF2 时缺省 */
  memory?: number;
  /** Argon2id 并行度，降级 PBKDF2 时缺省 */
  parallelism?: number;
};

/**
 * 账号库元信息（GET /api/vault/meta）。
 * 只含密钥派生与包裹所需的公开参数，不含任何账号明文；
 * 主密码正确与否由客户端解密 wrapped_dek 时的 GCM 校验判断。
 */
export type VaultMetaType = {
  initialized: boolean;
  /** 加密格式版本，首版为 1 */
  version: number;
  kdf: VaultKdfAlgorithmType;
  /** 实际写入数据库的 KDF 参数（Argon2id 才用到 kdf_memory / kdf_parallelism） */
  kdf_iterations?: number | null;
  kdf_memory?: number | null;
  kdf_parallelism?: number | null;
  /** 16 字节随机盐，Base64 */
  salt: string;
  /** 被 KEK 用 AES-256-GCM 包裹的 DEK，Base64 */
  wrapped_dek: string;
  /** 包裹 DEK 使用的 12 字节 nonce，Base64 */
  wrap_nonce: string;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * 写入 vault_meta 的载荷（`POST /api/vault/setup` 与 `POST /api/vault/change-master` 共用）。
 * 字段名与后端 `Utils\VaultMetaPayload::parse()` 一一对应：密文以 Base64 传输，落库为 BLOB。
 * 这里只有密文与公开参数，**永远不含主密码本身**——主密码只在前端派生 KEK 时用到。
 */
export type VaultMetaPayloadType = {
  /** 加密格式版本，首版固定 1（后端缺省同值） */
  version?: number;
  kdf: VaultKdfAlgorithmType;
  kdf_memory: number;
  kdf_iterations: number;
  kdf_parallelism: number;
  /** 16 字节随机盐，Base64 */
  salt: string;
  /** 被 KEK 包裹的 DEK，Base64 */
  wrapped_dek: string;
  /** 包裹 DEK 的 12 字节 nonce，Base64 */
  wrap_nonce: string;
};

/**
 * 账号库初始化失败的归因（refinements-v0.1.2 §4.3）。
 * insecure = 非安全上下文（HTTP，crypto.subtle 不可用）；network = fetch 本身失败；
 * server = 后端返回的 message。设置表单据此展示可重试的具体原因。
 */
export type VaultSetupErrorType = {
  kind: 'insecure' | 'network' | 'server';
  message: string;
};

/** 账号密文集合：缺省表示该字段未填写，不是「空字符串」 */
export type AccountSecretsType = {
  password?: VaultSecretField | null;
  totp?: VaultSecretField | null;
  notes?: VaultSecretField | null;
};

/** 账号元数据（PRD §6.2 / §8.2）；secrets 只在详情接口返回 */
export type AccountType = {
  id: number;
  name: string;
  platform: string;
  identifier: string;
  group_id?: number | null;
  /** 详情接口返回的分组名，列表接口可能缺省 */
  group?: string | null;
  login_url?: string | null;
  /** 通过库内哪个账号登录（如 X 通过 Google 主账号） */
  login_via_account_id?: number | null;
  secrets?: AccountSecretsType;
  password_updated_at?: string | null;
  last_used_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** 分组字典项：GET /api/servers/groups 与 GET /api/account-groups 的出参同形（refinements-v0.1.2 §3.2） */
export type GroupDictItemType = {
  id: number;
  name: string;
  /** 字典排序值（升序展示，sort 越小越靠前） */
  sort: number;
  /** 组内数据条数：服务器为台数、账号为账号数；为 0 的分组也返回 */
  count: number;
};

/** 账号分组（PRD §6.3 / refinements-v0.1.2 §3.2）：字典接口返回的名称 + 条数 */
export type AccountGroupType = GroupDictItemType;

export type AccountAuthorizationStatusType = 'active' | 'revoked';

/** 授权关系（PRD §6.4） */
export type AccountAuthorizationType = {
  id: number;
  /** 来源账号 */
  account_id: number;
  /** 站点 / 服务，如 X、Notion、Slack */
  service: string;
  identifier: string;
  note?: string | null;
  /** 关联到库内账号，可空；只能指向账号库内部账号 */
  linked_account_id?: number | null;
  status: AccountAuthorizationStatusType;
  granted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** 账号详情 = 元数据 + 密文 + 授权关系（GET /api/accounts/detail） */
export type AccountDetailType = AccountType & {
  authorizations: AccountAuthorizationType[];
};

/**
 * 账号列表查询参数（GET /api/accounts，PRD §8.2）。
 * 都不传时后端返回全量（侧栏平台计数依赖全量数据派生）。
 */
export type AccountListParamsType = {
  search?: string;
  /** 平台精确匹配 */
  platform?: string | null;
  /** 分组 id 筛选 */
  group?: number | null;
  /** 排序列名，走 Repository 白名单：updated_at / created_at / name / platform / password_updated_at */
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
};

/**
 * 新建账号的请求体（POST /api/accounts）。
 * secrets 里的密文由前端用 DEK 加密后传入，服务端只搬运不解密（PRD §6.5 / §7.5）。
 */
export type AccountInputType = {
  name: string;
  platform: string;
  identifier: string;
  login_url?: string | null;
  group_id?: number | null;
  login_via_account_id?: number | null;
  secrets?: AccountSecretsType | null;
};

/**
 * 新建授权关系的请求体（POST /api/accounts/authorizations）。
 * 授权字段是明文元数据（站点 / 站点账号 / 备注 / 授权日期），不含任何凭据（PRD §6.4）。
 */
export type AuthorizationInputType = {
  account_id: number;
  service: string;
  identifier?: string | null;
  note?: string | null;
  linked_account_id?: number | null;
  status?: AccountAuthorizationStatusType;
  granted_at?: string | null;
};

/**
 * 加密备份文件（.slvault）的顶层结构（PRD §8.1）。
 * 与后端 VaultExportController 的输出一一对应：KDF 元信息 + 账号（元数据 + 密文 + 授权关系）。
 * 文件里没有任何明文——解密只发生在浏览器，服务端连 DEK 都没有。
 */
export type VaultBackupAccountType = AccountType & {
  authorizations: AccountAuthorizationType[];
};

export type VaultBackupType = {
  /** 加密格式版本，首版为 1 */
  version: number;
  /** 导出时间（ISO 8601） */
  exported_at: string;
  kdf: VaultKdfAlgorithmType;
  kdf_memory: number;
  kdf_iterations: number;
  kdf_parallelism: number;
  /** 16 字节随机盐，Base64 */
  salt: string;
  /** 被 KEK 包裹的 DEK，Base64 */
  wrapped_dek: string;
  /** 包裹 DEK 使用的 12 字节 nonce，Base64 */
  wrap_nonce: string;
  accounts: VaultBackupAccountType[];
};

/**
 * 导入模式：
 * - merge：合并（默认）。本地已存在同 id 的账号 / 授权跳过并保留本地版本，其余以新 id 导入，
 *   且要求备份与当前账号库是同一把 DEK（否则导入的账号在本地无法解密，后端会拒绝）；
 * - replace：覆盖。清空现有账号与授权后按备份原样恢复，vault_meta 也以备份为准。
 */
export type VaultImportModeType = 'merge' | 'replace';

/** GitHub 网络访问三档策略（PRD O-5，与后端 Config::GITHUB_ACCESS_MODES 一致） */
export type GithubAccessModeType = 'auto' | 'proxy' | 'direct';

/** 设置 → 网络：GET 返回 / POST 保存的配置结构（数据库设置优先，环境变量仅初始默认值） */
export type NetworkSettingsType = {
  mode: GithubAccessModeType;
  /** 代理前缀，如 https://gh-proxy.com/；空串表示未配置 */
  proxy_prefix: string;
  /** 是否启用应用版本检查（关闭后不再请求 api.github.com） */
  update_check: boolean;
};

/** 测试连接结果：只做 HEAD 探测，不可达时也返回 200 + reachable=false */
export type NetworkTestResultType = {
  reachable: boolean;
  /** 实际探测的目标（走代理时含代理前缀） */
  target: string;
  elapsed_ms: number;
  error: string | null;
};

/* ---------------------------------------------------------------------------
 * 服务器监控（PRD docs/prd/server.md §5.1 / §5.5 / §6）
 * 说明：字段与后端 Utils\ServerPayload::formatServer() 及 ServersGet /
 * ServersDetail / ServersMetrics 三个控制器的 data 数组键名一一对应
 * （§6 为草案，契约漂移由 task21 双向比对收口）；token_hash / token_salt
 * 属服务端凭据材料，任何用户态类型都不包含这两列（PRD §5.6 / D6）。
 * ------------------------------------------------------------------------- */

/**
 * 连接状态四态（ServerPayload::STATUS_*，PRD §5.1 卡片状态点 / 详情页徽章）：
 * online 在线（注册表有活跃连接）/ offline 离线（曾回传、当前无连接）/
 * paused 已暂停（暂停期间不判定离线）/ pending 等待连接（从未回传）
 */
export type ServerStatusType = 'online' | 'offline' | 'paused' | 'pending';

/**
 * 服务器分组名称（refinements-v0.1.2 §3.1 / §3.2）：
 * 分组改为字典表（server_groups）驱动，名称是任意非空字符串，不再是固定四项联合类型。
 * 可选值请从 GET /api/servers/groups 拿（store.serverGroupDict）。
 */
export type ServerGroupType = string;

/** 服务器分组字典项（GET /api/servers/groups 出参元素） */
export type ServerGroupItemType = GroupDictItemType;

/** 历史指标范围档位（ServersMetricsController::RANGES，PRD §6；30d 为服务端小时聚合） */
export type ServerRangeType = '1h' | '6h' | '24h' | '30d';

/** 列表排序键（ServersGetController::SORT_KEYS：状态 / 名称 / CPU / 内存，另带分组与时间列） */
export type ServerSortType =
  | 'id'
  | 'name'
  | 'group'
  | 'status'
  | 'cpu'
  | 'mem'
  | 'last_report_at'
  | 'created_at'
  | 'updated_at';

export type ServerOrderType = 'asc' | 'desc';

/**
 * 服务器公开字段（ServerPayload::formatServer 白名单）。
 * 系统信息（os_name / kernel / cpu_cores / ip_address / agent_version）以 servers
 * 冗余列存储，随基本信息一并返回，不单独拆接口（PRD §6 数据模型）。
 */
export type ServerBaseType = {
  id: number;
  name: string;
  note: string;
  /** 列名叫 group_name（避开 SQL 关键字歧义），对外统一输出 group */
  group: string;
  paused: boolean;
  os_name: string;
  kernel: string;
  cpu_cores: number;
  ip_address: string;
  agent_version: string;
  /** 最后回传时间（服务端接收时间，Y-m-d H:i:s）；从未回传为 null */
  last_report_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** 公开字段 + 连接状态：列表 / 详情 / 新增 / 更新响应的 server 基础形态 */
export type ServerWithStatusType = ServerBaseType & {
  status: ServerStatusType;
};

/** 单块磁盘用量（server_disks 最新一批：一次快照每挂载点一行，PRD §5.3） */
export type ServerDiskType = {
  mount: string;
  used: number;
  total: number;
};

/**
 * 最新指标快照（server_metrics 最新一行）。
 * 单位一律为库内原始单位：字节 / 字节每秒 / 百分比 / 秒，换算与阈值配色在前端做；
 * null = 从未回传（等待连接），前端据此不渲染指标行（PRD §5.1）。
 */
export type ServerMetricsSnapshotType = {
  cpu: number;
  mem_used: number;
  mem_total: number;
  mem_cached: number;
  swap_used: number;
  swap_total: number;
  load1: number;
  load5: number;
  load15: number;
  /** 网络速率，字节每秒（agent 侧算好回传） */
  net_rx: number;
  net_tx: number;
  /** 开机时长，秒 */
  uptime: number;
  received_at: string;
};

/**
 * 列表项（ServersGetController::formatServerWithSummary）：
 * 公开字段 + 状态 + 最新快照摘要 + 最新一批磁盘 + 容器计数（明细在详情页）。
 */
export type ServerItemType = ServerWithStatusType & {
  latest: ServerMetricsSnapshotType | null;
  disks: ServerDiskType[];
  docker_count: number;
};

/** Docker 容器（server_docker 最新一批，PRD §5.3；Docker 不可用或没有容器时为空数组） */
export type ServerDockerType = {
  container: string;
  cpu: number;
  mem_used: number;
  mem_limit: number;
  net_rx: number;
  net_tx: number;
  state: string;
  received_at: string;
};

/** 服务器详情（GET /api/servers/detail 的 data） */
export type ServerDetailType = {
  server: ServerWithStatusType;
  docker: ServerDockerType[];
};

/**
 * 历史指标单点（ServersMetricsController::formatPoint）。
 * 明细点与 30d 小时聚合桶字段完全同构（聚合桶 received_at 形如 '2026-11-16 14:00:00'），
 * 图表代码无需区分来源（决策 D4：不建聚合表）。
 */
export type ServerMetricsPointType = ServerMetricsSnapshotType;

/** 历史指标序列（GET /api/servers/metrics 的 data）；空结果（等待连接 / 时段无数据）为 total=0 */
export type ServerMetricsSeriesType = {
  server_id: number;
  range: ServerRangeType;
  points: ServerMetricsPointType[];
  total: number;
};

/**
 * 侧栏分组计数：键为字典里的全部分组名称（后端按字典输出全部名称，为 0 也返回），
 * 按搜索命中全集统计，不受分组筛选影响（PRD §5.5 / refinements-v0.1.2 §3.2）。
 */
export type ServerGroupCountsType = Record<string, number>;

/**
 * 列表查询参数（GET /api/servers）。
 * 可下推后端（与账号库 fetchAccounts 带参一致），也可作为客户端筛选排序的条件：
 * 搜索覆盖名称 / 备注 / IP，排序支持状态 / 名称 / CPU / 内存（PRD §5.5）。
 */
export type ServerListParamsType = {
  search?: string;
  group?: ServerGroupType | null;
  sort?: ServerSortType;
  order?: ServerOrderType;
};

/** 新建服务器（POST /api/servers，ServerPayload::parseCreate） */
export type ServerInputType = {
  name: string;
  note?: string;
  /** 缺省「家庭」（后端同款默认值，PRD §5.1） */
  group?: ServerGroupType;
};

/**
 * 更新服务器（PATCH /api/servers，ServerPayload::parsePatch）。
 * PATCH 语义：未传字段保持原值——只想改备注不会把分组冲掉、把暂停的服务器恢复；
 * paused 显式传空会被后端拒绝（暂停 / 恢复是二值动作，必须给明确值）。
 */
export type ServerUpdateType = {
  name?: string;
  note?: string;
  group?: ServerGroupType;
  paused?: boolean;
};

/**
 * Token 响应（POST /api/servers 与 POST /api/servers/token 共用同形）。
 * token 明文只在一次响应里完整出现，不落库、不写日志（PRD §5.6 / D6 选项 b），
 * 丢失只能重置；install_command 由后端 Utils\ServerInstallCommand 组装，
 * 弹窗直接把含 Token 的一行命令给用户一键复制。
 */
export type ServerTokenResponseType = {
  token: string;
  install_command: string;
};

/** 新增响应（POST /api/servers 的 data）：新服务器 agent 尚未连接，status 必为 pending */
export type ServerCreateResultType = ServerTokenResponseType & {
  server: ServerWithStatusType;
};

/* ---------------------------------------------------------------------------
 * 备份 / 恢复（dev-spec §6，refinements.md §4）
 * GET /api/backup/<module> 的响应体本身就是备份文件内容；POST
 * /api/backup/<module>/restore 走 success 包裹，data 即 BackupRestoreResultType。
 * 逐条结果只含名称与状态，后端不回显任何凭据字段（服务器备份的哈希 / 盐只进文件）。
 * ------------------------------------------------------------------------- */

/** 备份模块：同时决定端点路径与文件名 super-link-<module>-YYYYMMDD.json */
export type BackupModuleType = 'bookmarks' | 'skills' | 'servers';

/** 恢复模式：merge 合并（默认）/ overwrite 覆盖（服务器覆盖模式会清理备份外条目） */
export type BackupRestoreModeType = 'merge' | 'overwrite';

/** 逐条恢复状态（dev-spec §6.5，与各 BackupRestorer 输出一致） */
export type BackupRestoreItemType = {
  name: string;
  status: 'new' | 'updated' | 'same' | 'skipped' | 'failed';
  /** 失败原因 / 跳过说明，可选 */
  message?: string;
};

/**
 * 恢复分类汇总：键随模块略有差异——updated 只有 Skill / 服务器才有，
 * 书签侧不返回该键；前端按可选读取，不要假定一定存在。
 */
export type BackupRestoreSummaryType = {
  new: number;
  updated?: number;
  same: number;
  skipped: number;
  failed: number;
};

/** 恢复结果（执行 dry_run=false；预检响应为扁平字段，由 mainStore 归一化后同形） */
export type BackupRestoreResultType = {
  dry_run: boolean;
  mode: BackupRestoreModeType;
  summary: BackupRestoreSummaryType;
  items: BackupRestoreItemType[];
  /** 语义说明：Skill / 服务器的恢复边界提示（如上传来源跳过、覆盖删服务器） */
  note?: string;
  /** 仅服务器：覆盖模式下将删除 / 已删除的备份外服务器数 */
  removed?: number;
  /** 仅书签：标签维度的新建 / 复用数 */
  tags?: { new: number; same: number };
  /**
   * 仅服务器 / 账号库恢复：本次（或将）自动新建的分组数（refinements-v0.1.2 §3.4）。
   * 预检扁平响应与执行响应同名字段同口径，store 归一化后原样透传。
   */
  groups_created?: number;
};
