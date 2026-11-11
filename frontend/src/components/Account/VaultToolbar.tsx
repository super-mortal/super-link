import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { KeyRound, Lock, LockOpen, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { VAULT_PASSWORD_INPUT_ID } from '@/components/Account/VaultUnlockForm.tsx';

/**
 * 账号库工具栏（PRD §5.3）。
 *
 * 解锁态：侧栏开关 + 模块名 + 添加账号 + 立即锁定；
 * 锁定态：侧栏开关 + 「账号库已锁定」+ 解锁账号库（聚焦主密码输入框）——按 PRD §5.3
 * 「只保留」的枚举，不渲染添加账号等任何写操作 / 查看明文入口。
 * 布局 / 搜索 / 排序 / 可见字段随账号列表布局一起在后续任务接入。
 */
export const VaultToolbar = observer(() => {
  const vault = React.useContext(VaultStoreContext);
  const locked = !vault.unlocked;

  const handleAdd = () => {
    // 只有解锁态才会渲染这个按钮，这里不再做锁定判断（PRD §5.3 锁定态枚举里没有它）
    // TODO(后续任务)：打开「添加账号」四段式弹窗（基础信息 / 凭据与 2FA / 授权关系 / 备注）
    toast('添加账号弹窗将在后续任务接入', { position: 'top-center' });
  };

  /** 解锁表单就在本页锁定态里渲染，这里只负责把焦点送到主密码输入框 */
  const focusUnlockForm = () => {
    document.getElementById(VAULT_PASSWORD_INPUT_ID)?.focus();
  };

  return (
    <header className="bg-background sticky top-0 z-50 flex h-14 w-full items-center gap-1.5 border-b px-4">
      <SidebarToggler />

      {locked ? (
        <>
          <Lock className="text-muted-foreground h-4 w-4" />
          <span className="text-sm font-medium">账号库已锁定</span>
          <Button variant="outline" className="ml-auto" onClick={focusUnlockForm}>
            <LockOpen />
            <span className="hidden @xl/main:inline-block">解锁账号库</span>
          </Button>
        </>
      ) : (
        <>
          <KeyRound className="h-4 w-4" />
          <span className="text-sm font-medium">账号库</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="default" onClick={handleAdd}>
              <PlusIcon />
              <span className="hidden @xl/main:inline-block">添加账号</span>
            </Button>
            <Button variant="outline" onClick={() => vault.lock()}>
              <Lock />
              <span className="hidden @xl/main:inline-block">锁定</span>
            </Button>
          </div>
        </>
      )}
    </header>
  );
});
