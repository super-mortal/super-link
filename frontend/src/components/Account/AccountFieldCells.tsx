import type { Row } from '@tanstack/react-table';
import type { ModuleItemType } from '@/lib/modules.ts';
import type { AccountType } from '@/lib/types.ts';
import { PlatformBadge, TotpBadge } from '@/components/Account/AccountBadges.tsx';
import { CopySecretButton, PasswordMask, RevealSecretButton } from '@/components/Account/SecretButtons.tsx';
import { useAccountSecretActions } from '@/hooks/useAccountSecretActions.ts';

/**
 * 账号表格的行数据必然全是账号：账号库是独立路由 + 独立接口（PRD §5.1.1），
 * 与书签 / Skill 不共用一张表，这里用收窄断言代替运行时判别。
 */
const accountOf = (item: ModuleItemType) => item as AccountType;

export const AccountPlatformCell = ({ row }: { row: Row<ModuleItemType> }) => (
  <PlatformBadge platform={accountOf(row.original).platform} />
);

export const AccountIdentifierCell = ({ row }: { row: Row<ModuleItemType> }) => {
  const account = accountOf(row.original);
  const { copyIdentifier } = useAccountSecretActions();

  return (
    <div className="flex items-center gap-1">
      <span className="truncate" title={account.identifier}>
        {account.identifier}
      </span>
      <CopySecretButton onCopy={() => copyIdentifier(account.identifier)} label="复制账号标识" />
    </div>
  );
};

/** 密码列：默认掩码；没有密码密文（如第三方登录账号）时渲染占位「—」 */
export const AccountPasswordCell = ({ row }: { row: Row<ModuleItemType> }) => {
  const account = accountOf(row.original);
  const { revealPassword, copyPassword, copyPasswordConfirmDialog } = useAccountSecretActions();

  if (!account.secrets?.password) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center gap-1">
      <PasswordMask />
      <RevealSecretButton onReveal={revealPassword} label="显示密码" />
      <CopySecretButton onCopy={copyPassword} label="复制密码" />
      {/* 复制密码二次确认弹窗（PRD §7.3）：每个密码单元格自带一个实例，互不影响 */}
      {copyPasswordConfirmDialog}
    </div>
  );
};

export const AccountTotpCell = ({ row }: { row: Row<ModuleItemType> }) => (
  <TotpBadge enabled={Boolean(accountOf(row.original).secrets?.totp)} />
);

/**
 * 授权数列：列表接口不返回授权条数（授权关系只存在于详情，PRD §8.2），
 * 先占位「—」，真实授权关系在详情页（task10）展示。
 */
export const AccountAuthorizationsCell = () => <span className="text-muted-foreground">—</span>;

/** 备注列：备注是密文字段，列表态不解密（task10 按需解密），占位「—」 */
export const AccountNotesCell = () => <span className="text-muted-foreground">—</span>;
