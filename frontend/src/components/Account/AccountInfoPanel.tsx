import { type ReactNode, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { formatAccountDate, passwordAgeDays, PASSWORD_STALE_DAYS } from '@/lib/accountFormat.ts';
import { normalizedSourceURL } from '@/components/Table/Fields/moduleItem.ts';
import { StoreContext } from '@/store/storeContext.ts';
import type { AccountDetailType } from '@/lib/types.ts';

/** 右栏信息的一行：标签左、值右；值可省略号截断 */
const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-3">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="min-w-0 text-right">{children}</span>
  </div>
);

/**
 * 右栏信息（PRD §10.4 / §10.5）：基本信息 + 账号状态。
 *
 * 「登录方式」展示 login_via_account_id 指向的库内账号，点击跳转到对应账号详情
 * （PRD §10.5 一键定位）。账号名从已加载的列表数据里查找——账号库侧栏本来就持有
 * 全量账号用于平台计数，正常情况下已加载；找不到时退化为「账号 #id」，跳转不受影响。
 */
export const AccountInfoPanel = ({ account }: { account: AccountDetailType }) => {
  const store = useContext(StoreContext);
  const navigate = useNavigate();

  const hasPassword = Boolean(account.secrets?.password);
  const hasTotp = Boolean(account.secrets?.totp);
  const ageDays = passwordAgeDays(account);
  const loginViaID = account.login_via_account_id ?? null;
  const loginViaName = loginViaID
    ? (store.accounts.find((item) => item.id === loginViaID)?.name ?? `账号 #${loginViaID}`)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-[13px]">
          <InfoRow label="平台">{account.platform}</InfoRow>
          <InfoRow label="分组">{account.group ?? '未分组'}</InfoRow>
          <InfoRow label="登录地址">
            {account.login_url ? (
              <a
                href={normalizedSourceURL(account.login_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {account.login_url}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </InfoRow>
          <InfoRow label="登录方式">
            {loginViaID ? (
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                title="查看该账号详情"
                onClick={() => navigate(`/accounts/${loginViaID}`)}
              >
                {loginViaName}
              </button>
            ) : (
              <span className="text-muted-foreground">直接登录</span>
            )}
          </InfoRow>
          <InfoRow label="创建时间">{formatAccountDate(account.created_at)}</InfoRow>
          <InfoRow label="修改时间">{formatAccountDate(account.updated_at)}</InfoRow>
          <InfoRow label="最近使用">
            {account.last_used_at ? (
              formatAccountDate(account.last_used_at)
            ) : (
              <span className="text-muted-foreground">从未使用</span>
            )}
          </InfoRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">账号状态</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-[13px]">
          <InfoRow label="两步验证">
            {hasTotp ? '已开启' : <span className="text-muted-foreground">未开启</span>}
          </InfoRow>
          <InfoRow label="密码">
            {hasPassword ? (
              ageDays !== null ? (
                `${ageDays} 天未修改`
              ) : (
                <span className="text-muted-foreground">修改时间未知</span>
              )
            ) : (
              <span className="text-muted-foreground">未设置密码</span>
            )}
          </InfoRow>
          {ageDays !== null && ageDays > PASSWORD_STALE_DAYS && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              密码已超过 {PASSWORD_STALE_DAYS} 天未修改，建议尽快更换
            </p>
          )}
          <InfoRow label="授权数量">{account.authorizations.length} 条</InfoRow>
        </CardContent>
      </Card>
    </div>
  );
};
