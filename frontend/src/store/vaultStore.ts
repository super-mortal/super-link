/**
 * 账号库 UI 状态 store。
 *
 * 职责边界（PRD §9.2）：
 * - 这里**只**保存「界面看到的状态」：是否已初始化、是否解锁、错误文案、失败次数、
 *   自动锁定分钟数、上次解锁时间。
 * - DEK 与解密缓存一律放在 `lib/vaultSession.ts`（模块级变量，非 observable），
 *   原因见该文件头注释：observable 会被调试工具 / 序列化快照带出内存。
 * - 所有后端调用走 `mainStore`（AGENTS.md 硬约定），本文件不直接 fetch。
 *
 * 安全相关的取舍：
 * 1. 解锁失败不提示具体原因（PRD §7.2）：主密码错误与数据损坏统一显示「主密码错误」，
 *    并在连续失败后按 0.5s → 1s → 2s → 4s → 5s 递增延迟，抬高在线爆破速度。
 * 2. 自动锁定 15 秒检查一次空闲时长；页面隐藏超过阈值也直接锁定（隐藏期间拿不到用户活动事件）。
 * 3. `beforeunload` 清空会话，配合「DEK 只在内存」，刷新即重新锁定。
 */

import { makeAutoObservable } from 'mobx';
import { mainStore } from './mainStore.ts';
import { preferencesStore } from './preferencesStore.ts';
import {
  DEFAULT_KDF_MEMORY_KIB,
  DEFAULT_KDF_PARALLELISM,
  DEFAULT_KDF_PARAMS,
  MIN_MASTER_PASSWORD_LENGTH,
} from '@/lib/vaultConstants.ts';
import { deriveKek, generateDek, generateSalt, unwrapDek, wrapDek } from '@/lib/vaultCrypto.ts';
import * as vaultSession from '@/lib/vaultSession.ts';
import type { VaultKdfParamsType, VaultMetaPayloadType, VaultMetaType } from '@/lib/types.ts';

/** 自动锁定检查间隔：15 秒足够精确到「分钟级」阈值，又不至于频繁唤醒主线程 */
const AUTO_LOCK_CHECK_INTERVAL_MS = 15_000;
/** 解锁失败的基础延迟与上限（PRD §7.2） */
const UNLOCK_BASE_DELAY_MS = 500;
const UNLOCK_MAX_DELAY_MS = 5_000;
/** 首版加密格式版本，与后端 `VaultMetaPayload::DEFAULT_VERSION` 一致 */
const VAULT_FORMAT_VERSION = 1;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** 第 n 次连续失败后的延迟：0.5s → 1s → 2s → 4s → 上限 5s */
const unlockDelayFor = (failedAttempts: number): number => {
  if (failedAttempts <= 0) {
    return 0;
  }
  return Math.min(UNLOCK_BASE_DELAY_MS * 2 ** (failedAttempts - 1), UNLOCK_MAX_DELAY_MS);
};

/** 把后端 meta 转成 deriveKek 需要的参数；kdf 缺失时回落到默认值，避免旧数据无法解锁 */
const kdfParamsOf = (meta: VaultMetaType): VaultKdfParamsType => ({
  algorithm: meta.kdf ?? DEFAULT_KDF_PARAMS.algorithm,
  iterations: meta.kdf_iterations ?? DEFAULT_KDF_PARAMS.iterations,
  hash: DEFAULT_KDF_PARAMS.hash,
  memory: meta.kdf_memory ?? DEFAULT_KDF_MEMORY_KIB,
  parallelism: meta.kdf_parallelism ?? DEFAULT_KDF_PARALLELISM,
});

/** 组装写入 vault_meta 的载荷（setup / change-master 共用） */
const buildMetaPayload = (salt: string, wrapped: { ct: string; iv: string }): VaultMetaPayloadType => ({
  version: VAULT_FORMAT_VERSION,
  kdf: DEFAULT_KDF_PARAMS.algorithm,
  kdf_memory: DEFAULT_KDF_PARAMS.memory ?? DEFAULT_KDF_MEMORY_KIB,
  kdf_iterations: DEFAULT_KDF_PARAMS.iterations,
  kdf_parallelism: DEFAULT_KDF_PARAMS.parallelism ?? DEFAULT_KDF_PARALLELISM,
  salt,
  wrapped_dek: wrapped.ct,
  wrap_nonce: wrapped.iv,
});

class VaultStore {
  /** null = 尚未拿到后端状态（加载中 / 加载失败）；false = 未初始化；true = 已初始化 */
  initialized: boolean | null = null;
  /** true 表示 meta 拉取失败（与「未初始化」区分开，否则会误显示「设置主密码」） */
  metaLoadFailed = false;
  /** 解锁失败提示；PRD 要求不泄露细节，文案固定 */
  unlockError: string | null = null;
  /** 非解锁类操作（初始化 / 改密 / 重置）的错误提示，展示在对应表单内 */
  error: string | null = null;
  /** 连续解锁失败次数，用于递进延迟（解锁成功即清零） */
  failedAttempts = 0;
  /** 自动锁定分钟数（0 = 不自动锁定），来自偏好设置并可写回 */
  autoLockMinutes = preferencesStore.vaultAutoLockMinutes;
  /** 上次解锁时间戳（毫秒） */
  lastUnlockAt: number | null = null;
  /** 是否有 vault 相关异步操作正在进行（控制按钮 disabled / loading） */
  isPending = false;

  /** 解锁态标记；真实来源仍是 vaultSession，见下方 unlocked getter */
  private unlockedFlag = false;
  /** 后端 meta（盐 / 密文 / KDF 参数），都是密文或公开参数，不含任何明文 */
  private meta: VaultMetaType | null = null;
  /** 页面切到后台的时刻，用于判断「隐藏时长是否已超过自动锁定阈值」 */
  private hiddenAt: number | null = null;
  /** 自动锁定巡检定时器句柄 */
  private autoLockTimer: number | null = null;

  constructor() {
    // unlocked 用普通 getter（不缓存）：它要读非 observable 的 vaultSession，
    // 若被 MobX 当作 computed 缓存，外部 clearSession 后可能读到过期的 true。
    makeAutoObservable(this, { unlocked: false });
    this.bindLifecycle();
  }

  /**
   * 是否已解锁：必须同时满足「store 标记为解锁」与「内存里真的有 DEK」。
   * 这样即使某条路径只清了会话没改标记，界面也会立刻回落到锁定态。
   */
  get unlocked(): boolean {
    return this.unlockedFlag && vaultSession.isUnlocked();
  }

  /* ----------------------------- 生命周期 ----------------------------- */

  /** 注册活动监听、页面可见性、卸载清理与自动锁定巡检；只在构造时调用一次 */
  private bindLifecycle = () => {
    if (typeof window === 'undefined') {
      return;
    }

    // 活动事件只更新空闲计时，不做任何状态写入：高频事件必须保持零渲染开销
    const onActivity = () => {
      if (this.unlocked) {
        vaultSession.touchActivity();
      }
    };
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // 刷新 / 关闭页面时清空密钥（PRD §7.2）；内存本身会随页面销毁，这里是显式兜底
    window.addEventListener('beforeunload', this.clearOnUnload);

    this.autoLockTimer = window.setInterval(this.checkAutoLock, AUTO_LOCK_CHECK_INTERVAL_MS);
  };

  private clearOnUnload = () => {
    vaultSession.clearSession();
  };

  /** 页面从后台回到前台：隐藏时长超过阈值视为空闲，直接锁定 */
  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      return;
    }

    const hiddenFor = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
    this.hiddenAt = null;

    if (!this.unlocked) {
      return;
    }

    const minutes = this.autoLockMinutes;
    if (minutes > 0 && hiddenFor >= minutes * 60_000) {
      this.lock();
      return;
    }

    // 隐藏时间未超阈值：回到页面本身算一次活动，避免用户刚切回就被锁
    vaultSession.touchActivity();
  };

  /** 自动锁定巡检：空闲时长达到阈值即清空会话 */
  private checkAutoLock = () => {
    if (!this.unlocked) {
      return;
    }

    const minutes = this.autoLockMinutes;
    if (minutes > 0 && vaultSession.getIdleMs() >= minutes * 60_000) {
      this.lock();
    }
  };

  /* ----------------------------- 元信息 ----------------------------- */

  /**
   * 读取账号库元信息，决定锁定页展示「设置主密码」还是「账号库已锁定」。
   * 失败时保持 initialized = null 并置 metaLoadFailed，由路由守卫提示重试，
   * 绝不能直接当成「未初始化」——那会让用户误以为要重新设置主密码而覆盖旧密钥。
   */
  loadMeta = async (): Promise<boolean> => {
    if (this.isPending) {
      return false;
    }

    this.isPending = true;
    try {
      const meta = await mainStore.fetchVaultMeta();
      if (!meta) {
        this.metaLoadFailed = true;
        return false;
      }

      this.metaLoadFailed = false;
      this.initialized = Boolean(meta.initialized);
      this.meta = meta.initialized ? meta : null;
      return true;
    } finally {
      this.isPending = false;
    }
  };

  /* ----------------------------- 解锁 / 锁定 ----------------------------- */

  /**
   * 解锁：派生 KEK → 解 wrapped_dek → 写入内存会话。
   * 失败一律显示「主密码错误」（不区分密码错与数据损坏，避免给攻击者信号），
   * 并按连续失败次数递增延迟。
   */
  unlock = async (password: string): Promise<boolean> => {
    if (this.isPending) {
      return false;
    }
    if (!password) {
      this.unlockError = '请输入主密码';
      return false;
    }

    this.isPending = true;
    this.unlockError = null;
    try {
      const meta = this.meta ?? (await mainStore.fetchVaultMeta());
      if (!meta || !meta.initialized) {
        this.unlockError = '账号库尚未初始化，请先设置主密码';
        return false;
      }
      if (meta.kdf !== DEFAULT_KDF_PARAMS.algorithm) {
        // 数据里记录的是 Argon2id 而当前环境只有 PBKDF2：这不是密码问题，必须区分提示
        this.unlockError = '当前浏览器不支持该账号库使用的加密算法';
        return false;
      }

      const kek = await deriveKek(password, meta.salt, kdfParamsOf(meta));
      const dek = await unwrapDek(kek, meta.wrapped_dek, meta.wrap_nonce);

      vaultSession.setSession(dek);
      this.meta = meta;
      this.unlockedFlag = true;
      this.failedAttempts = 0;
      this.lastUnlockAt = Date.now();
      this.initialized = true;
      return true;
    } catch {
      this.failedAttempts += 1;
      this.unlockError = '主密码错误';
      // 延迟期间保持 isPending = true，解锁按钮持续禁用，迫使用户等待
      await wait(unlockDelayFor(this.failedAttempts));
      return false;
    } finally {
      this.isPending = false;
    }
  };

  /** 手动锁定 / 自动锁定：清空 DEK 与解密缓存，并复位错误提示 */
  lock = () => {
    vaultSession.clearSession();
    this.unlockedFlag = false;
    this.unlockError = null;
    this.error = null;
    this.hiddenAt = null;
  };

  /**
   * TODO(后续任务)：PRD §7.2 还要求「退出登录 / 切换用户」立即清空 DEK。
   * 目前没有在 mainStore.logOut 里回调本 store（会造成 mainStore → vaultStore 循环依赖），
   * 待设置页 / 用户菜单接入账号库后再在退出流程里显式调用 lock()。
   */

  /* ----------------------------- 初始化 ----------------------------- */

  /**
   * 首次设置主密码：生成盐 + DEK，用 KEK 包裹后交给后端保存，成功后直接进入解锁态。
   * 主密码不离开浏览器，也不进任何 store 字段或日志。
   */
  setupVault = async (password: string): Promise<boolean> => {
    if (this.isPending) {
      return false;
    }
    if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
      this.error = `主密码至少 ${MIN_MASTER_PASSWORD_LENGTH} 个字符`;
      return false;
    }

    this.isPending = true;
    this.error = null;
    try {
      const salt = generateSalt(DEFAULT_KDF_PARAMS.saltBytes ?? 16);
      const kek = await deriveKek(password, salt, DEFAULT_KDF_PARAMS);
      const dek = await generateDek();
      const wrapped = await wrapDek(kek, dek);

      const ok = await mainStore.setupVault(buildMetaPayload(salt, wrapped));
      if (!ok) {
        this.error = '设置主密码失败，请稍后重试';
        return false;
      }

      // 刚生成的 DEK 直接放进内存会话：无需让用户再用同一密码解锁一次
      vaultSession.setSession(dek);
      this.meta = {
        initialized: true,
        version: VAULT_FORMAT_VERSION,
        kdf: DEFAULT_KDF_PARAMS.algorithm,
        kdf_iterations: DEFAULT_KDF_PARAMS.iterations,
        kdf_memory: DEFAULT_KDF_PARAMS.memory ?? null,
        kdf_parallelism: DEFAULT_KDF_PARAMS.parallelism ?? null,
        salt,
        wrapped_dek: wrapped.ct,
        wrap_nonce: wrapped.iv,
      };
      this.unlockedFlag = true;
      this.initialized = true;
      this.failedAttempts = 0;
      this.lastUnlockAt = Date.now();
      return true;
    } catch {
      this.error = '设置主密码失败，请稍后重试';
      return false;
    } finally {
      this.isPending = false;
    }
  };

  /* ----------------------------- 换主密码 / 重置 ----------------------------- */

  /**
   * 更换主密码：用旧主密码解出 DEK，再用新主密码派生 KEK 重新包裹同一把 DEK。
   * 这样不需要重新加密任何账号字段；旧密码正确性由 GCM 校验在本地判断。
   */
  changeMasterPassword = async (oldPassword: string, newPassword: string): Promise<boolean> => {
    if (this.isPending) {
      return false;
    }
    if (!this.unlocked) {
      this.error = '请先解锁账号库';
      return false;
    }
    if (newPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
      this.error = `新主密码至少 ${MIN_MASTER_PASSWORD_LENGTH} 个字符`;
      return false;
    }

    this.isPending = true;
    this.error = null;
    try {
      const meta = this.meta ?? (await mainStore.fetchVaultMeta());
      if (!meta || !meta.initialized) {
        this.error = '账号库尚未初始化';
        return false;
      }

      let dek: CryptoKey;
      try {
        const oldKek = await deriveKek(oldPassword, meta.salt, kdfParamsOf(meta));
        dek = await unwrapDek(oldKek, meta.wrapped_dek, meta.wrap_nonce);
      } catch {
        this.error = '当前主密码不正确';
        return false;
      }

      const salt = generateSalt(DEFAULT_KDF_PARAMS.saltBytes ?? 16);
      const newKek = await deriveKek(newPassword, salt, DEFAULT_KDF_PARAMS);
      const wrapped = await wrapDek(newKek, dek);

      const ok = await mainStore.changeMasterPassword(buildMetaPayload(salt, wrapped));
      if (!ok) {
        this.error = '更换主密码失败，请稍后重试';
        return false;
      }

      // DEK 未变，内存会话继续有效，只是记录里换成了新的包裹信息
      this.meta = {
        ...meta,
        version: VAULT_FORMAT_VERSION,
        kdf: DEFAULT_KDF_PARAMS.algorithm,
        kdf_iterations: DEFAULT_KDF_PARAMS.iterations,
        kdf_memory: DEFAULT_KDF_PARAMS.memory ?? null,
        kdf_parallelism: DEFAULT_KDF_PARAMS.parallelism ?? null,
        salt,
        wrapped_dek: wrapped.ct,
        wrap_nonce: wrapped.iv,
      };
      vaultSession.setSession(dek);
      this.lastUnlockAt = Date.now();
      return true;
    } catch {
      this.error = '更换主密码失败，请稍后重试';
      return false;
    } finally {
      this.isPending = false;
    }
  };

  /**
   * 重置账号库（PRD §7.7：忘记主密码只能重置，原密文永久不可解）。
   * `loginPassword` 只用于前端二次确认，不发送给服务端（见 mainStore.resetVault 注释）。
   */
  resetVault = async (loginPassword: string): Promise<boolean> => {
    if (this.isPending) {
      return false;
    }
    if (!loginPassword) {
      this.error = '请输入登录密码以确认重置';
      return false;
    }

    this.isPending = true;
    this.error = null;
    try {
      const ok = await mainStore.resetVault();
      if (!ok) {
        this.error = '重置账号库失败，请稍后重试';
        return false;
      }

      this.lock();
      this.meta = null;
      this.initialized = false;
      this.failedAttempts = 0;
      return true;
    } finally {
      this.isPending = false;
    }
  };

  /* ----------------------------- 偏好 ----------------------------- */

  /** 修改自动锁定分钟数并持久化到偏好（0 = 不自动锁定） */
  setAutoLockMinutes = (minutes: number) => {
    this.autoLockMinutes = minutes;
    preferencesStore.setVaultAutoLockMinutes(minutes);
  };
}

export const vaultStore = new VaultStore();
