import { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { VaultToolbar } from '@/components/Account/VaultToolbar.tsx';
import { VaultLockScreen } from '@/components/Account/VaultLockScreen.tsx';
import { AccountVaultList } from '@/components/Account/AccountVaultList.tsx';

/**
 * `/accounts` 账号库页面（PRD §5.2 / §5.3）。
 *
 * 两种形态：
 * - 已解锁：账号列表（三种布局 + 搜索 / 排序 / 平台分组筛选 / 分页 / 批量删除）；
 * - 未解锁 / 未初始化：锁定页（设置主密码或输入主密码解锁）。
 *
 * 两种形态都套 Dashboard 布局：锁定态也要保留侧栏（平台标签 + 计数）与工具栏
 * （PRD §5.3 / §10.1），所以解锁判断放在本页，而不是在路由守卫里提前拦截成整页锁定页。
 */
export const AccountVault = observer(() => {
  const vault = useContext(VaultStoreContext);

  return (
    <Dashboard>
      {vault.unlocked ? (
        <AccountVaultList />
      ) : (
        <>
          <VaultToolbar />
          <VaultLockScreen />
        </>
      )}
    </Dashboard>
  );
});
