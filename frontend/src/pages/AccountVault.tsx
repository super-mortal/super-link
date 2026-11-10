import { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';

/**
 * `/accounts` 已解锁后的占位容器。
 *
 * TODO(后续任务)：替换为账号列表（列表 / 卡片 / 表格三布局）、详情页与「添加账号」弹窗；
 * 那时侧栏模块注册表（lib/modules.ts）会加入 accounts，本页改为套 Dashboard 布局。
 * 现在只保留「已解锁 + 手动锁定」这一条可用路径，方便验证会话生命周期。
 */
export const AccountVault = observer(() => {
  const vault = useContext(VaultStoreContext);

  return (
    <div className="bg-background flex min-h-screen w-full items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-xl">账号库已解锁</CardTitle>
          <CardDescription>账号列表、详情与添加弹窗会在后续任务接入，这里先保留占位容器。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            账号列表占位
          </div>
          <Button variant="outline" className="self-start" onClick={() => vault.lock()}>
            <Lock />
            锁定账号库
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});
