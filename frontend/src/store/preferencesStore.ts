import { makeAutoObservable, autorun } from 'mobx';
import { DEFAULT_AUTOLOCK_MINUTES } from '@/lib/vaultConstants.ts';

class PreferencesStore {
  includeNestedTagItems = true;
  displaySidebarTagItemCounts = true;
  /** 账号库自动锁定分钟数（0 = 不自动锁定），默认 30 分钟（PRD §7.2） */
  vaultAutoLockMinutes = DEFAULT_AUTOLOCK_MINUTES;
  /** 账号库：详情页打开时自动解密并显示 TOTP 动态码；关闭则改为点击「显示动态码」后按需解密（PRD §7.4 防泄漏） */
  vaultTotpAutoReveal = false;
  /** 账号库：复制密码前弹二次确认（PRD §7.3，默认关闭；剪贴板不做定时清空，确认是唯一缓冲） */
  vaultCopyPasswordConfirm = false;

  constructor() {
    makeAutoObservable(this);

    this.load();

    autorun(() => {
      localStorage.setItem(
        'app:preferences',
        JSON.stringify({
          includeNestedTagItems: this.includeNestedTagItems,
          displaySidebarTagItemCounts: this.displaySidebarTagItemCounts,
          vaultAutoLockMinutes: this.vaultAutoLockMinutes,
          vaultTotpAutoReveal: this.vaultTotpAutoReveal,
          vaultCopyPasswordConfirm: this.vaultCopyPasswordConfirm,
        })
      );
    });
  }

  load() {
    try {
      const stored = localStorage.getItem('app:preferences');
      if (!stored) {
        return;
      }

      const data = JSON.parse(stored);

      Object.assign(this, data);
    } catch {
      // Ignore storage errors - failing silently is acceptable for preferences
    }
  }

  setIncludeNestedTagItems = (val: boolean) => {
    this.includeNestedTagItems = val;
  };

  setDisplaySidebarTagItemCounts = (val: boolean) => {
    this.displaySidebarTagItemCounts = val;
  };

  setVaultAutoLockMinutes = (val: number) => {
    this.vaultAutoLockMinutes = val;
  };

  setVaultTotpAutoReveal = (val: boolean) => {
    this.vaultTotpAutoReveal = val;
  };

  setVaultCopyPasswordConfirm = (val: boolean) => {
    this.vaultCopyPasswordConfirm = val;
  };
}

export const preferencesStore = new PreferencesStore();
