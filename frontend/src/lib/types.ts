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
  favorite: boolean;
  secrets?: AccountSecretsType;
  password_updated_at?: string | null;
  last_used_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** 账号分组（PRD §6.3） */
export type AccountGroupType = {
  id: number;
  name: string;
  sort: number;
};

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
  favorite?: boolean;
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
