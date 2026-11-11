import { Trash2 } from 'lucide-react';
import { AuthorizationStatusBadge } from '@/components/Account/AccountBadges.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { formatAccountDate } from '@/lib/accountFormat.ts';
import type { AccountAuthorizationType } from '@/lib/types.ts';

type AuthorizationCardProps = {
  authorization: AccountAuthorizationType;
  /** 关联账号名；linked_account_id 有值但库里找不到（账号已被删除）时为 null */
  linkedAccountName: string | null;
  /** 点击卡片打开只读详情弹窗（PRD §9.8 / §10.4） */
  onOpen: () => void;
  /** 跳转关联账号详情（PRD §10.5 一键定位「这个站点用哪个账号」） */
  onNavigateLinked: () => void;
  /** 移除授权信号：删除与刷新由父级统一处理，二次确认弹窗在本组件内就近触发 */
  onRemove: () => void | Promise<void>;
};

/**
 * 授权双列紧凑卡片（PRD §9.8 / §10.4）：站点、站点账号、备注、授权日期、状态徽章、
 * 关联账号入口。整卡点击打开详情弹窗；删除按钮 hover 显现，且必须阻止冒泡——
 * 否则点击删除会先触发卡片的「打开详情」，确认框与详情弹窗叠在一起。
 */
export const AuthorizationCard = ({
  authorization,
  linkedAccountName,
  onOpen,
  onNavigateLinked,
  onRemove,
}: AuthorizationCardProps) => {
  const linkedID = authorization.linked_account_id ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      title="查看授权详情"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="onhover-container hover:border-muted-foreground/40 hover:bg-accent/30 flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={authorization.service}>
          {authorization.service}
        </span>
        <AuthorizationStatusBadge status={authorization.status} />
        <span className="onhover-visible flex shrink-0" onClick={(event) => event.stopPropagation()}>
          <DeleteDialog onConfirm={onRemove} itemsCount={1} noun="授权">
            <button
              type="button"
              aria-label="移除授权"
              title="移除授权"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive bg-background flex size-6 items-center justify-center rounded-md border shadow-xs transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </DeleteDialog>
        </span>
      </div>

      {authorization.identifier ? (
        <span className="text-muted-foreground truncate text-xs" title={authorization.identifier}>
          {authorization.identifier}
        </span>
      ) : null}

      {authorization.note ? (
        <span className="text-muted-foreground line-clamp-2 text-xs" title={authorization.note}>
          {authorization.note}
        </span>
      ) : null}

      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground shrink-0">{formatAccountDate(authorization.granted_at)}</span>
        {linkedID ? (
          linkedAccountName ? (
            <button
              type="button"
              className="text-primary min-w-0 truncate underline underline-offset-2"
              title={`查看账号：${linkedAccountName}`}
              onClick={(event) => {
                event.stopPropagation();
                onNavigateLinked();
              }}
            >
              {linkedAccountName}
            </button>
          ) : (
            // 账号可能已被删除：悬空引用只提示、不跳转，避免导航到 404 详情页
            <span className="text-muted-foreground shrink-0" title="关联的账号已被删除">
              账号已删除
            </span>
          )
        ) : null}
      </div>
    </div>
  );
};
