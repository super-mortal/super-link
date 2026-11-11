import { useEffect, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { CopySecretButton, PasswordMask, RevealSecretButton } from '@/components/Account/SecretButtons.tsx';
import { TotpCode } from '@/components/Account/TotpCode.tsx';
import { formatAccountDate, formatRelativePast } from '@/lib/accountFormat.ts';
import { copySecret } from '@/lib/copySecret.ts';
import type { AccountSecretActionsType } from '@/hooks/useAccountSecretDecrypt.ts';
import type { AccountDetailType } from '@/lib/types.ts';

type AccountCredentialsProps = {
  account: AccountDetailType;
  /** 由详情页统一持有：密码明文只在这一条链路上驻留组件 state，不进 MobX / 存储 */
  secretActions: AccountSecretActionsType;
};

/** 一行凭据：左侧定宽标签，右侧内容与操作按钮；窄屏折为上下两行 */
const CredentialLine = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1.5 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:gap-4 sm:border-b">
    <span className="text-muted-foreground w-20 shrink-0 pt-0.5 text-[13px]">{label}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
  </div>
);

/**
 * 凭据区（PRD §10.4）：账号标识 + 复制；密码（掩码 / 明文、上次修改与年龄、显示 / 复制）；
 * 两步验证（动态码 + 倒计时 + 发行方账号 + 复制）。
 *
 * 密码遵循 PRD §7.4「详情页默认掩码，点击显示才渲染明文」；TOTP 则在挂载后即按需
 * 解密——动态码的价值就在于打开详情就能抄录，且它 30 秒轮换、暴露窗口本身极短。
 * 没有密文的字段（第三方登录账号没有密码 / 未配 2FA）整行不渲染，由头部徽章传达状态。
 */
export const AccountCredentials = ({ account, secretActions }: AccountCredentialsProps) => {
  const {
    password,
    passwordVisible,
    passwordPending,
    passwordError,
    revealPassword,
    hidePassword,
    copyPassword,
    totp,
    totpPending,
    totpError,
    loadTotp,
  } = secretActions;

  const hasPassword = Boolean(account.secrets?.password);
  const hasTotp = Boolean(account.secrets?.totp);

  useEffect(() => {
    if (hasTotp) {
      void loadTotp();
    }
  }, [hasTotp, loadTotp]);

  const relativeChange = formatRelativePast(account.password_updated_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">凭据</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CredentialLine label="账号标识">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] break-all">{account.identifier}</span>
            <CopySecretButton
              onCopy={() => void copySecret(account.identifier)}
              label="复制账号标识"
              className="ml-auto"
            />
          </div>
        </CredentialLine>

        {hasPassword && (
          <CredentialLine label="密码">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {passwordPending && !password ? (
                <Spinner className="text-muted-foreground size-4" />
              ) : passwordVisible && password ? (
                <span className="font-mono text-[13px] break-all">{password}</span>
              ) : (
                <PasswordMask />
              )}
              <span className="text-muted-foreground text-xs">
                上次修改：{formatAccountDate(account.password_updated_at)}
                {relativeChange ? `（${relativeChange}改过）` : ''}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <RevealSecretButton
                  revealed={passwordVisible}
                  onReveal={() => {
                    if (passwordVisible) {
                      hidePassword();
                      return;
                    }
                    void revealPassword();
                  }}
                />
                <CopySecretButton onCopy={() => void copyPassword()} label="复制密码" />
              </div>
            </div>
            {passwordError && <p className="text-destructive text-xs">{passwordError}</p>}
          </CredentialLine>
        )}

        {hasTotp && (
          <CredentialLine label="两步验证">
            {totpPending && !totp ? <span className="text-muted-foreground text-xs">解密中…</span> : null}
            {totpError ? <p className="text-destructive text-xs">{totpError}</p> : null}
            {totp ? <TotpCode secret={totp.secret} issuer={totp.issuer} account={totp.account} /> : null}
          </CredentialLine>
        )}
      </CardContent>
    </Card>
  );
};
