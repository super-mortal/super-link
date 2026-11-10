import type { VaultKdfParamsType } from '@/lib/types.ts';

/**
 * 账号库前端常量（纯数据，无副作用）。
 * 与后端字段、PRD 取值保持同步；改动时前后端需一起改。
 */

/**
 * 默认 KDF 参数。
 *
 * PRD §7.1 首选 Argon2id（m=64MiB, t=3, p=1），但浏览器 WebCrypto 没有原生 Argon2，
 * 而项目禁止新增 npm 依赖（`npm ci` + 锁文件固定），因此首版统一降级为
 * PBKDF2-HMAC-SHA256。迭代次数取 600,000：这是 OWASP 2023 对 PBKDF2-SHA256 的推荐下限，
 * 在普通笔记本上约 0.3~0.6 秒，既能抬高离线爆破成本，也不至于让解锁明显卡顿。
 *
 * 注意：`algorithm` 只是能力开关，`deriveKek()` 真正执行时仍按 PBKDF2 计算，
 * 未来若引入 Argon2 实现，只需新增实现并调整这里，`vault_meta.kdf` 已能表达 argon2id。
 */

/**
 * Argon2id 的参考参数：首版实际按 PBKDF2 计算，这两项只是写进 `vault_meta` 的记录值
 * （后端 `VaultMetaPayload::parse()` 要求 kdf_memory / kdf_parallelism 为整数）。
 * 将来换成真正的 Argon2id 实现时，可以直接沿用这里记录的内存与并行度。
 */
export const DEFAULT_KDF_MEMORY_KIB = 65_536;
export const DEFAULT_KDF_PARALLELISM = 1;

/** 默认 KDF 参数（见上方说明） */
export const DEFAULT_KDF_PARAMS: VaultKdfParamsType = {
  algorithm: 'pbkdf2-sha256',
  iterations: 600_000,
  hash: 'SHA-256',
  saltBytes: 16,
  memory: DEFAULT_KDF_MEMORY_KIB,
  parallelism: DEFAULT_KDF_PARALLELISM,
};

/** 自动锁定时长（分钟）默认值：30 分钟无操作即清空内存密钥 */
export const DEFAULT_AUTOLOCK_MINUTES = 30;

/** 自动锁定下拉可选值（分钟）；0 表示不自动锁定 */
export const AUTOLOCK_OPTIONS: readonly number[] = [1, 5, 15, 30, 60, 0];

/** DEK 字节长度（AES-256） */
export const DEK_BYTES = 32;

/** AES-GCM nonce 长度：12 字节是 GCM 的推荐值，兼顾安全与性能 */
export const GCM_IV_BYTES = 12;

/** 主密码最小长度（PRD §7.1） */
export const MIN_MASTER_PASSWORD_LENGTH = 12;
