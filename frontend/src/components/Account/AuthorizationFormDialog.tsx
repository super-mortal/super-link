import { useContext, useEffect, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import type { AccountAuthorizationStatusType, AccountAuthorizationType, AuthorizationInputType } from '@/lib/types.ts';

type AuthorizationFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 来源账号 id：写进 payload，同时用于关联账号下拉排除自身 */
  accountId: number;
  /** 传值即编辑模式（载入该行现值），null 为新增 */
  authorization?: AccountAuthorizationType | null;
  /** 提交成功（store 已按后端 message toast）后由父级关闭弹窗并刷新详情 */
  onSubmitted: () => void | Promise<void>;
};

/** 今天的日期（YYYY-MM-DD）：新增授权默认当天，与后端缺省值保持一致 */
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Radix Select 不允许空字符串 value，「不关联」用哨兵值表示 */
const NO_LINKED_VALUE = 'none';

/** 表单字段外壳：标签 + 必填星号；className 供跨列字段使用 */
const FormField = ({
  label,
  htmlFor,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
    <label htmlFor={htmlFor} className="text-[13px] font-medium">
      {label}
      {required && <span className="text-destructive"> *</span>}
    </label>
    {children}
  </div>
);

/**
 * 新增 / 编辑授权弹窗（PRD §9.8 / §10.3 / §10.4）：站点、站点账号标识、备注、关联账号、
 * 状态、授权日期。新增与编辑复用同一弹窗——两边的字段与校验完全一致，拆成两个弹窗
 * 只会让校验逻辑复制两份。
 */
export const AuthorizationFormDialog = observer(
  ({ open, onOpenChange, accountId, authorization, onSubmitted }: AuthorizationFormDialogProps) => {
    const store = useContext(StoreContext);
    const isEdit = Boolean(authorization);

    const [service, setService] = useState('');
    const [identifier, setIdentifier] = useState('');
    const [note, setNote] = useState('');
    const [linkedAccountId, setLinkedAccountId] = useState<string>(NO_LINKED_VALUE);
    const [status, setStatus] = useState<AccountAuthorizationStatusType>('active');
    const [grantedAt, setGrantedAt] = useState(todayISO);
    const [serviceError, setServiceError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // 每次打开都按初始值重置：新增回到空表单 + 今天，编辑载入该行现值
    useEffect(() => {
      if (!open) {
        return;
      }
      setService(authorization?.service ?? '');
      setIdentifier(authorization?.identifier ?? '');
      setNote(authorization?.note ?? '');
      setLinkedAccountId(authorization?.linked_account_id ? String(authorization.linked_account_id) : NO_LINKED_VALUE);
      setStatus(authorization?.status ?? 'active');
      setGrantedAt(authorization?.granted_at ? authorization.granted_at.slice(0, 10) : todayISO());
      setServiceError(null);
    }, [open, authorization]);

    // 关联账号下拉排除自身：授权指向自己没有「换个账号登录」的语义，后端同样有
    // 自环校验，前端先拦可以减少一次无效请求与困惑的错误提示
    const linkedOptions = store.accounts.filter((item) => item.id !== accountId);

    const handleSubmit = async () => {
      if (submitting) {
        return;
      }
      const trimmedService = service.trim();
      if (!trimmedService) {
        setServiceError('站点不能为空');
        return;
      }

      const payload: AuthorizationInputType = {
        account_id: accountId,
        service: trimmedService,
        identifier: identifier.trim() || null,
        note: note.trim() || null,
        linked_account_id: linkedAccountId === NO_LINKED_VALUE ? null : Number(linkedAccountId),
        status,
        granted_at: grantedAt || null,
      };

      setSubmitting(true);
      try {
        // 成功 / 失败提示由 runRequest 按后端 message 统一 toast；失败时保持弹窗打开，
        // 用户改完直接重试，不用重新点「添加授权」
        const ok = authorization
          ? await store.updateAuthorization(authorization.id, payload)
          : (await store.createAuthorization(payload)) !== null;
        if (ok) {
          await onSubmitted();
        }
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-base">{isEdit ? '编辑授权' : '添加授权'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="站点" htmlFor="authorization-service" required>
              <Input
                id="authorization-service"
                value={service}
                onChange={(event) => {
                  setService(event.target.value);
                  setServiceError(null);
                }}
                placeholder="如 X、Notion、Slack"
                autoComplete="off"
                disabled={submitting}
                aria-invalid={serviceError ? true : undefined}
              />
              {serviceError && <p className="text-destructive text-xs">{serviceError}</p>}
            </FormField>

            <FormField label="站点账号标识" htmlFor="authorization-identifier">
              <Input
                id="authorization-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="如 mortal@gmail.com"
                autoComplete="off"
                disabled={submitting}
              />
            </FormField>

            <FormField label="备注" htmlFor="authorization-note" className="sm:col-span-2">
              <Input
                id="authorization-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="如 用 Google 一键登录"
                autoComplete="off"
                disabled={submitting}
              />
            </FormField>

            <FormField label="关联账号" htmlFor="authorization-linked">
              <Select
                value={linkedAccountId}
                onValueChange={setLinkedAccountId}
                disabled={submitting || linkedOptions.length === 0}
              >
                <SelectTrigger id="authorization-linked" className="w-full">
                  <SelectValue placeholder="选择关联账号" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINKED_VALUE}>不关联</SelectItem>
                  {linkedOptions.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name} · {item.platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="状态" htmlFor="authorization-status">
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as AccountAuthorizationStatusType)}
                disabled={submitting}
              >
                <SelectTrigger id="authorization-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">生效中</SelectItem>
                  <SelectItem value="revoked">已失效</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="授权日期" htmlFor="authorization-granted-at">
              <Input
                id="authorization-granted-at"
                type="date"
                value={grantedAt}
                onChange={(event) => setGrantedAt(event.target.value)}
                disabled={submitting}
              />
              <p className="text-muted-foreground text-xs">默认今天</p>
            </FormField>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting && <Spinner />}
              {submitting ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);
