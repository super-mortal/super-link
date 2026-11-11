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
 * 账号库卡片布局（PRD §9.3 / §9.4）。
 *
 * 与书签 `CardsLayout` 共用同一套骨架（复选框左上、操作按钮右上、底部元信息），
 * 账号差异点：标题行不换行、平台徽章固定右上角、「账号标识 + 密码」合并行、
 * 底部展示更新时间与 2FA 状态。每个区块由 `visibleFields` 门控。
 */
export const AccountCards = ({ rows, visibleFields }: ModuleLayoutProps) => {
  const moduleConfig = MODULES.accounts;
  const openItem = useModuleItemOpen('accounts');
  const { copyIdentifier, revealPassword, copyPassword, copyPasswordConfirmDialog } = useAccountSecretActions();
  const visible = new Set(visibleFields);

  return (
    <div className="m-4 grid grid-cols-1 gap-4 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3 @7xl/main:grid-cols-4">
      {/* 复制密码二次确认弹窗（PRD §7.3）：整个卡片布局共用一个实例 */}
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
          <div
            key={account.id}
            data-slot="card"
            data-state={isSelected ? 'selected' : undefined}
            className={cn(
              'onhover-container from-muted/70 to-card relative flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-gradient-to-t p-4 text-left',
              'hover:border-muted-foreground/40 transition-[box-shadow,border-color,background-color] hover:shadow-md',
              'data-[state=selected]:bg-muted/50 data-[state=selected]:bg-none'
            )}
            onClick={() => openItem(account)}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="选择"
              onClick={(event) => event.stopPropagation()}
              className={cn('onhover-visible bg-background absolute top-2 left-2 z-40', isSelected && 'opacity-100!')}
            />

            <div className="absolute top-2 right-2 z-30">
              <ModuleCardActions module="accounts" item={account} />
            </div>

            {/* 标题行不换行：标题可省略并透出 title，平台徽章 margin-left:auto 固定在右上角（PRD §9.4）；
                O-8：与书签/Skill 卡片一致，右移 12px（pl-3）避让左上多选框留约 4px 净空、下移 2px（pt-0.5）视觉找齐 */}
            <div className="flex flex-nowrap items-center gap-1.5 pt-0.5 pr-20 pl-3">
              <h4 className="min-w-0 flex-[0_1_auto] truncate font-semibold tracking-tight" title={account.name}>
                {account.name}
              </h4>
              {showPlatform && <PlatformBadge platform={account.platform} className="ml-auto flex-none" />}
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

            {/* 卡片底部：更新时间 + 2FA 状态（PRD §9.4） */}
            <div className="text-muted-foreground mt-auto flex items-center justify-between gap-3 border-t pt-2 text-[11px]">
              <span>
                {moduleConfig.dateLabel}：{formatCardDate(moduleConfig.dateOf(account))}
              </span>
              {showTotp && <TotpBadge enabled={Boolean(account.secrets?.totp)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
};
