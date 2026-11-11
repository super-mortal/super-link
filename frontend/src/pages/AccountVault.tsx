import { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { VaultToolbar } from '@/components/Account/VaultToolbar.tsx';
import { VaultLockScreen } from '@/components/Account/VaultLockScreen.tsx';

/**
 * `/accounts` 账号库页面（PRD §5.2 / §5.3）。
 *
 * 两种形态：
 * - 已解锁：占位容器——账号列表三布局、详情页与「添加账号」弹窗在后续任务接入；
 * - 未解锁 / 未初始化：锁定页（设置主密码或输入主密码解锁）。
 *
 * 两种形态都套 Dashboard 布局：锁定态也要保留侧栏（平台标签 + 计数）与工具栏
 * （PRD §5.3 / §10.1），所以解锁判断放在本页，而不是在路由守卫里提前拦截成整页锁定页。
 */
export const AccountVault = observer(() => {
  const vault = useContext(VaultStoreContext);

  return (
    <Dashboard>
      <VaultToolbar />

      {vault.unlocked ? (
        <Card className="m-4 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-xl">账号库已解锁</CardTitle>
            <CardDescription>账号列表、详情与添加弹窗会在后续任务接入，这里先保留占位容器。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
              账号列表占位
            </div>
          </CardContent>
        </Card>
      ) : (
        <VaultLockScreen />
      )}
    </Dashboard>
  );
});
