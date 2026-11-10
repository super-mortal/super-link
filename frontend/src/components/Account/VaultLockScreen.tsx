import { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { LockKeyhole, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { VaultSetupForm } from '@/components/Account/VaultSetupForm.tsx';
import { VaultUnlockForm } from '@/components/Account/VaultUnlockForm.tsx';
import { EMPTY_VAULT_STATS, VaultStatsRow, type VaultStatsType } from '@/components/Account/VaultStatsRow.tsx';

type VaultLockScreenProps = {
  /**
   * 账号统计占位：本任务账号数据还不存在，默认渲染 0。
   * TODO(后续任务)：账号列表接口接入后由调用方传入真实统计（只含数量，不含账号内容）。
   */
  stats?: VaultStatsType;
};

/**
 * 账号库锁定页（PRD §10.1）。
 *
 * 两种形态由 vaultStore.initialized 决定：
 * - 未初始化：设置主密码（含二次确认、长度校验）+「忘记主密码将无法恢复」警示；
 * - 已初始化：主密码解锁 + 自动锁定说明 + 不泄露细节的错误提示。
 *
 * 整页居中、不挂在 Dashboard 侧栏里：锁定态不应让任何账号内容进入 DOM。
 */
export const VaultLockScreen = observer(({ stats = EMPTY_VAULT_STATS }: VaultLockScreenProps) => {
  const vault = useContext(VaultStoreContext);
  const isInitialized = vault.initialized === true;

  return (
    <div className="bg-background flex min-h-screen w-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="bg-muted text-muted-foreground mb-1 flex h-10 w-10 items-center justify-center rounded-full">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">{isInitialized ? '账号库已锁定' : '设置主密码'}</CardTitle>
          <CardDescription>
            {isInitialized
              ? '输入主密码解锁账号库，解锁后密码与 2FA 才会在本地解密显示。'
              : '主密码仅用于在本地加解密账号数据，不会上传到服务器。'}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <VaultStatsRow stats={stats} />

          {isInitialized ? <VaultUnlockForm /> : <VaultSetupForm />}

          {!isInitialized && (
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>主密码不会保存在任何地方。忘记主密码将无法恢复账号库，只能重置并重新录入。</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
