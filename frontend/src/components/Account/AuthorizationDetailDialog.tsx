import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { AuthorizationStatusBadge } from '@/components/Account/AccountBadges.tsx';
import { formatAccountDate } from '@/lib/accountFormat.ts';
import type { AccountAuthorizationType } from '@/lib/types.ts';

type AuthorizationDetailDialogProps = {
  authorization: AccountAuthorizationType;
  /** 关联账号名；linked_account_id 有值但库里找不到（账号已被删除）时为 null */
  linkedAccountName: string | null;
  onOpenChange: (open: boolean) => void;
  /** 编辑入口：复用同一个授权表单弹窗（PRD §10.3 授权行编辑） */
  onEdit: () => void;
  /** 移除授权：父级完成删除与详情刷新后负责关闭本弹窗 */
  onRemove: () => void | Promise<void>;
  /** 跳转关联账号详情（PRD §10.5） */
  onNavigateLinked: () => void;
};

/** 只读详情的一行：左侧定宽标签，右侧值；窄屏折为上下两行 */
const DetailRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:gap-4 sm:border-b">
    <span className="text-muted-foreground w-24 shrink-0 pt-0.5 text-[13px]">{label}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] break-all">{children}</div>
  </div>
);

/**
 * 授权详情弹窗（PRD §9.8 / §10.4）：只读展示站点、站点账号、备注、授权日期、状态与
 * 关联账号；底部提供「编辑」（打开授权表单弹窗）与「移除授权」（二次确认后由父级删除
 * 并刷新详情）。授权数据是明文元数据，弹窗内不出现任何密文字段。
 */
export const AuthorizationDetailDialog = ({
  authorization,
  linkedAccountName,
  onOpenChange,
  onEdit,
  onRemove,
  onNavigateLinked,
}: AuthorizationDetailDialogProps) => {
  const linkedID = authorization.linked_account_id ?? null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">授权详情</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <DetailRow label="站点">
            <span className="font-medium">{authorization.service}</span>
          </DetailRow>
          <DetailRow label="站点账号">
            {authorization.identifier || <span className="text-muted-foreground">—</span>}
          </DetailRow>
          <DetailRow label="备注">
            {authorization.note ? (
              <span className="whitespace-pre-line">{authorization.note}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </DetailRow>
          <DetailRow label="授权日期">{formatAccountDate(authorization.granted_at)}</DetailRow>
          <DetailRow label="状态">
            <AuthorizationStatusBadge status={authorization.status} />
          </DetailRow>
          <DetailRow label="关联账号">
            {linkedID ? (
              linkedAccountName ? (
                <button
                  type="button"
                  className="text-primary underline underline-offset-2"
                  title={`查看账号：${linkedAccountName}`}
                  onClick={onNavigateLinked}
                >
                  {linkedAccountName}
                </button>
              ) : (
                // 账号可能已被删除：悬空引用只提示、不跳转，避免导航到 404 详情页
                <span className="text-muted-foreground">账号已删除</span>
              )
            ) : (
              <span className="text-muted-foreground">未关联</span>
            )}
          </DetailRow>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* 移除授权复用统一的二次确认弹窗：授权记录删了不可恢复，且删除入口在卡片上
              只是一个小图标，容易误触 */}
          <DeleteDialog onConfirm={onRemove} itemsCount={1} noun="授权">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 />
              移除授权
            </Button>
          </DeleteDialog>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            编辑
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
