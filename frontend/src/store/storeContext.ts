import { createContext } from 'react';
import { mainStore } from './mainStore';
import { preferencesStore } from './preferencesStore.ts';
import { vaultStore } from './vaultStore.ts';

export const StoreContext = createContext<typeof mainStore | null>(null);
export const PreferencesStoreContext = createContext<typeof preferencesStore | null>(null);
/** 账号库 UI 状态（是否解锁、错误、自动锁定）；DEK 在 lib/vaultSession.ts，不经过任何 context */
export const VaultStoreContext = createContext<typeof vaultStore | null>(null);
