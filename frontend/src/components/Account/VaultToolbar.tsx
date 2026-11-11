import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { KeyRound, Lock, LockOpen, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { VAULT_PASSWORD_INPUT_ID } from '@/components/Account/VaultUnlockForm.tsx';
import { notifyAccountDialogPending } from '@/components/Account/accountMessages.ts';

type VaultToolbarProps = {
  /**
   * 解锁态的列表控制区（视图 / 搜索 / 排序 / 分组），由账号列表外壳注入：
   * 工具栏本身不感知 react-table，锁定态也不渲染任何列表控制（PRD §5.3）。
   */
  listControls?: React.ReactNode;
};

/**
 * 账号库工具栏（PRD §5.3）。
 *
 * 解锁态：侧栏开关 + 模块名 + 列表控制区 + 添加账号 + 立即锁定；
 * 锁定态：侧栏开关 + 「账号库已锁定」+ 解锁账号库（聚焦主密码输入框）——按 PRD §5.3
 * 「只保留」的枚举，不渲染添加账号等任何写操作 / 查看明文入口。
 */
export const VaultToolbar = observer(({ listControls }: VaultToolbarProps) => {
  const vault = React.useContext(VaultStoreContext);
  const locked = !vault.unlocked;

  const handleAdd = () => {
    // 只有解锁态才会渲染这个按钮，这里不再做锁定判断（PRD §5.3 锁定态枚举里没有它）
    notifyAccountDialogPending();
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
          {listControls}
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
