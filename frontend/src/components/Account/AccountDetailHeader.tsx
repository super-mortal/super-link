import { useCallback, useContext, useState } from 'react';
import { Copy, KeyRound, Lock, Pencil, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { PendingBadge, PlatformBadge, TotpBadge } from '@/components/Account/AccountBadges.tsx';
import { ACCOUNT_DELETE_HINT } from '@/components/Account/accountMessages.ts';
import { isAccountPending } from '@/lib/accountFormat.ts';
import { copySecret } from '@/lib/copySecret.ts';
import { cn } from '@/lib/utils.ts';
import { StoreContext } from '@/store/storeContext.ts';
import type { AccountDetailType } from '@/lib/types.ts';

type AccountDetailHeaderProps = {
  account: AccountDetailType;
  /** 头部「复制密码」：复用详情页同一份按需解密链路（60 秒缓存，不重复解） */
  onCopyPassword: () => Promise<void>;
  /** 收藏等写操作后重新拉取详情，刷新头部状态 */
  onRefresh: () => Promise<void>;
  onEdit: () => void;
  onLock: () => void;
  onDelete: () => Promise<void>;
};

/**
 * 详情页头部（PRD §10.4）：名称、收藏星标、平台 / 2FA / 待处理徽章，
 * 账号标识 · 分组 · 授权数量一行，以及复制账号、复制密码、编辑、锁定、删除操作。
 * <640px 时操作按钮只留图标（title 兜底说明，PRD §10.7）。
 */
export const AccountDetailHeader = ({
  account,
  onCopyPassword,
  onRefresh,
  onEdit,
  onLock,
  onDelete,
}: AccountDetailHeaderProps) => {
  const store = useContext(StoreContext);
  const [favoritePending, setFavoritePending] = useState(false);

  const toggleFavorite = useCallback(async () => {
    setFavoritePending(true);
    try {
      const ok = await store.updateAccount(account.id, { favorite: !account.favorite });
      // 写成功才回拉详情：失败时 store 已 toast，保持头部原状态
      if (ok) {
        await onRefresh();
      }
    } finally {
      setFavoritePending(false);
    }
  }, [store, account.id, account.favorite, onRefresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 text-xl font-semibold break-all">{account.name}</h1>
        <button
          type="button"
          disabled={favoritePending}
          aria-label={account.favorite ? '取消收藏' : '收藏'}
          title={account.favorite ? '取消收藏' : '收藏'}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={() => void toggleFavorite()}
        >
          <Star className={cn('size-4', account.favorite && 'fill-current text-amber-500 dark:text-amber-400')} />
        </button>
        <PlatformBadge platform={account.platform} />
        <TotpBadge enabled={Boolean(account.secrets?.totp)} />
        {isAccountPending(account) && <PendingBadge />}
      </div>

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className="break-all">{account.identifier}</span>
        <span aria-hidden="true">·</span>
        <span>{account.group ?? '未分组'}</span>
        <span aria-hidden="true">·</span>
        <span>授权 {account.authorizations.length} 条</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void copySecret(account.identifier)}>
          <Copy />
          <span className="hidden sm:inline">复制账号</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => void onCopyPassword()}>
          <KeyRound />
          <span className="hidden sm:inline">复制密码</span>
        </Button>
        {/* 编辑打开账号弹窗（与列表操作菜单同一入口）：详情页已加载，弹窗直接复用 */}
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil />
          <span className="hidden sm:inline">编辑</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onLock}>
          <Lock />
          <span className="hidden sm:inline">锁定</span>
        </Button>
        <DeleteDialog onConfirm={onDelete} itemsCount={1} noun="账号" description={ACCOUNT_DELETE_HINT}>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
            <span className="hidden sm:inline">删除</span>
          </Button>
        </DeleteDialog>
      </div>
    </div>
  );
};
