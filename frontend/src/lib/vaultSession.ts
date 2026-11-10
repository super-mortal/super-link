/**
 * 账号库内存会话：DEK（数据密钥）+ 解密结果缓存。
 *
 * 为什么是**模块级闭包变量 / Map，而不是 MobX observable**：
 * 1. MobX 会维护一棵可观测对象树，`mobx-devtools`、`JSON.stringify(toJS(store))`、
 *    状态快照上报、React DevTools 的 props/state 面板都能把这棵树的字段读出来；
 *    CryptoKey 虽然无法被 JSON 序列化，但解密后的**明文缓存是普通字符串**，一旦挂到
 *    observable 上就等于把明文密码 / TOTP 密钥放在了可被截图、可被扩展读取的界面状态里。
 * 2. 模块级变量只能被本模块导出的函数访问，不会被任何 store 或组件引用持有；
 *    页面刷新 / 关闭时随 JS 堆一起释放，天然满足 PRD §7.2「刷新页面即重新锁定」。
 * 3. 因此本模块只提供函数式 API，调用方（vaultStore、后续的 CredentialRow 等）拿到的是
 *    `CryptoKey | string`，而不是可观测引用。
 *
 * 安全边界：这里**绝不**写 localStorage / sessionStorage / IndexedDB / Cookie / 日志。
 * 每一次 `setSession()` 都会重置空闲计时；`clearSession()`（手动锁定、自动锁定、退出登录、
 * beforeunload）必须同时清空 DEK 与所有已解密缓存，避免锁定后仍能从缓存读到明文。
 */

/** 单条解密缓存的存活时间：PRD §7.4 建议 60 秒，过期后组件需要重新拉详情解密 */
const SECRET_CACHE_TTL_MS = 60_000;
/** 缓存条目上限：只做兜底，防止长时间使用时无限增长（正常使用远达不到） */
const SECRET_CACHE_MAX_ENTRIES = 200;

type SecretCacheEntryType = {
  value: string;
  expiresAt: number;
};

/** 当前会话的数据密钥；null 表示已锁定 */
let dek: CryptoKey | null = null;
/** 本次解锁时间戳（毫秒），仅用于展示与调试，不参与加密 */
let unlockedAt: number | null = null;
/** 最近一次用户活动时间戳（毫秒），自动锁定据此计算空闲时长 */
let lastActivityAt = 0;
/** 解密结果缓存：key 由调用方约定（例如 `account:12:password`），value 为明文 */
const secretCache = new Map<string, SecretCacheEntryType>();

/** 取当前 DEK；未解锁返回 null。调用方必须自己处理 null（不要缓存这个引用） */
export const getDek = (): CryptoKey | null => dek;

/** 解锁成功后写入会话：同时把空闲计时归零，避免刚解锁就被判定为空闲 */
export const setSession = (key: CryptoKey) => {
  dek = key;
  unlockedAt = Date.now();
  lastActivityAt = Date.now();
};

/** 清空会话：DEK 与解密缓存一起丢弃（锁定、退出登录、页面卸载都要走这里） */
export const clearSession = () => {
  dek = null;
  unlockedAt = null;
  lastActivityAt = 0;
  secretCache.clear();
};

/** 记录一次用户活动；未解锁时是无副作用的空操作 */
export const touchActivity = () => {
  if (dek !== null) {
    lastActivityAt = Date.now();
  }
};

/** 是否处于解锁态（真实来源，vaultStore 的 unlocked 只是它的 UI 投影） */
export const isUnlocked = (): boolean => dek !== null;

/** 本次解锁时间戳（毫秒）；未解锁为 null */
export const getUnlockedAt = (): number | null => unlockedAt;

/** 距离最近一次用户活动的毫秒数；未解锁为 0，自动锁定定时器据此判断 */
export const getIdleMs = (): number => (dek === null ? 0 : Date.now() - lastActivityAt);

/** 清掉已过期的缓存条目，避免 Map 长期持有过期明文（只在写入时顺手做，成本可忽略） */
const pruneExpired = () => {
  const now = Date.now();
  secretCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      secretCache.delete(key);
    }
  });
};

/** 缓存一条解密结果（默认 60 秒）。明文只驻留内存，禁止传入日志或 toast */
export const cacheSecret = (key: string, value: string) => {
  if (dek === null) {
    // 已锁定：拒绝写入，避免锁定后被业务代码重新填回明文缓存
    return;
  }
  if (secretCache.size >= SECRET_CACHE_MAX_ENTRIES) {
    pruneExpired();
  }
  secretCache.set(key, { value, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
};

/** 读取缓存的解密结果；不存在或已过期返回 null（过期条目顺手删除） */
export const readCachedSecret = (key: string): string | null => {
  const entry = secretCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    secretCache.delete(key);
    return null;
  }
  return entry.value;
};
