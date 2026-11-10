import { makeAutoObservable, autorun } from 'mobx';
import { DEFAULT_AUTOLOCK_MINUTES } from '@/lib/vaultConstants.ts';

class PreferencesStore {
  includeNestedTagItems = true;
  displaySidebarTagItemCounts = true;
  /** 账号库自动锁定分钟数（0 = 不自动锁定），默认 30 分钟（PRD §7.2） */
  vaultAutoLockMinutes = DEFAULT_AUTOLOCK_MINUTES;

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
}

export const preferencesStore = new PreferencesStore();
