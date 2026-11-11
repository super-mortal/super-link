import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { cn } from '@/lib/utils.ts';
import { MODULES } from '@/lib/modules.ts';
import { ModuleCardActions, useModuleItemOpen } from '@/components/Table/Fields/ModuleCardActions.tsx';
import { formatCardDate } from '@/components/Table/Fields/moduleItem.ts';
import type { ModuleLayoutProps } from '@/components/Table/Layouts/layoutTypes.ts';
import { CredentialRow } from '@/components/Account/CredentialRow.tsx';
import { EncryptedNotesHint, PlatformBadge, TotpBadge } from '@/components/Account/AccountBadges.tsx';
import { useAccountSecretActions } from '@/hooks/useAccountSecretActions.ts';
import type { AccountType } from '@/lib/types.ts';

/**
 * 账号库列表布局（PRD §9.3 / §9.4）。
 *
 * 与书签 `ListLayout` 同构：复选框左侧垂直居中、操作按钮右上角、整行点击进详情；
 * 差异只在内容区——「账号标识 + 密码」合并行、平台徽章、2FA 徽章、备注加密提示。
 * 每个区块由 `visibleFields` 门控，隐藏时不渲染也不占位。
 */
export const AccountList = ({ rows, visibleFields }: ModuleLayoutProps) => {
  const moduleConfig = MODULES.accounts;
  const openItem = useModuleItemOpen('accounts');
  const { copyIdentifier, revealPassword, copyPassword, copyPasswordConfirmDialog } = useAccountSecretActions();
  const visible = new Set(visibleFields);

  return (
    <div className="flex flex-col divide-y">
      {/* 复制密码二次确认弹窗（PRD §7.3）：整个列表共用一个实例，行内按钮只触发守卫 */}
      {copyPasswordConfirmDialog}
      {rows.map((row) => {
        // 账号布局只承载账号数据（独立路由 + 独立接口，PRD §5.1.1）
        const account = row.original as AccountType;
        const isSelected = row.getIsSelected();
        const showPlatform = visible.has('platform');
        const showIdentifier = visible.has('identifier');
        const showPassword = visible.has('password') && Boolean(account.secrets?.password);
        const showNotes = visible.has('notes') && Boolean(account.secrets?.notes);
        const showTotp = visible.has('totp');

        return (
          <div key={account.id} className="onhover-container relative">
            <div
              data-state={isSelected ? 'selected' : undefined}
              className="hover:bg-muted/30 data-[state=selected]:bg-muted/50 flex cursor-pointer flex-row items-start gap-4 px-8 py-6 transition-colors"
              onClick={() => openItem(account)}
            >
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left">
                <div className="flex flex-wrap items-center gap-1.5 pr-20">
                  <h4 className="min-w-0 truncate font-semibold tracking-tight" title={account.name}>
                    {account.name}
                  </h4>
                  {showPlatform && <PlatformBadge platform={account.platform} />}
                </div>

                {(showIdentifier || showPassword) && (
                  <CredentialRow
                    identifier={account.identifier}
                    showIdentifier={showIdentifier}
                    showPassword={showPassword}
                    onCopyIdentifier={() => copyIdentifier(account.identifier)}
                    onRevealPassword={revealPassword}
                    onCopyPassword={copyPassword}
                  />
                )}

                {showNotes && <EncryptedNotesHint />}

                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span>
                    {moduleConfig.dateLabel}：{formatCardDate(moduleConfig.dateOf(account))}
                  </span>
                  {showTotp && <TotpBadge enabled={Boolean(account.secrets?.totp)} />}
                </div>
              </div>
            </div>

            <Checkbox
              checked={isSelected}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="选择"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'onhover-visible bg-background absolute top-1/2 left-2 z-40 -translate-y-1/2',
                isSelected && 'opacity-100!'
              )}
            />

            <div className="absolute top-3 right-2 z-30">
              <ModuleCardActions module="accounts" item={account} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
