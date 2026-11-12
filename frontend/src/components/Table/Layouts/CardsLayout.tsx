import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { cn } from '@/lib/utils.ts';
import { MODULES } from '@/lib/modules.ts';
import { TagBadge } from '@/components/Table/Fields/TagBadge.tsx';
import { ItemSourceLine, SourceBadge, UpdateBadge } from '@/components/Table/Fields/SourceBadge.tsx';
import { ModuleCardActions, useModuleItemOpen } from '@/components/Table/Fields/ModuleCardActions.tsx';
import {
  formatCardDate,
  isAccountItem,
  isSkillItem,
  normalizedSourceURL,
  tagIDsOf,
} from '@/components/Table/Fields/moduleItem.ts';
import type { ModuleLayoutProps } from '@/components/Table/Layouts/layoutTypes.ts';

/**
 * 统一卡片：书签与 Skill 共用同一套骨架，各区域位置固定（不随内容多少塌缩）。
 * 顺序：左上复选框 → 标题 + 徽章 + 右上双按钮 → 链接/来源 → 描述 → 标签 → 底部元信息。
 * 每个可选区块都由 visibleFields 门控：隐藏时不渲染、不占位；可见时保持固定 min-h 占位。
 */
export const CardsLayout = ({ rows, module, visibleFields }: ModuleLayoutProps) => {
  const moduleConfig = MODULES[module];
  const openItem = useModuleItemOpen(module);
  const visible = new Set(visibleFields);
  const showDescription = visible.has('description');
  const showTags = visible.has('tags');

  return (
    <div className="m-4 grid grid-cols-1 gap-4 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3 @7xl/main:grid-cols-4">
      {rows.map((row) => {
        const item = row.original;
        const isSelected = row.getIsSelected();
        const skill = isSkillItem(item);
        const account = isAccountItem(item);
        const tagIDs = tagIDsOf(item);

        // Skill 的来源行没有对应字段 key（fields 只有描述/标签/安装时间/指纹），因此始终展示
        const showLink = skill || visible.has('url');
        const showFingerprint = skill && visible.has('fingerprint');
        const showDate = visible.has(skill ? 'installed_at' : 'created_at');
        const dateLine = `${moduleConfig.dateLabel}：${formatCardDate(moduleConfig.dateOf(item))}`;
        const updatedLine = `修改时间：${formatCardDate(moduleConfig.updatedOf(item))}`;
        const footerLeft = skill ? (showFingerprint ? item.fingerprint || '—' : null) : showDate ? dateLine : null;
        const footerRight = skill ? (showDate ? dateLine : null) : showDate ? updatedLine : null;

        return (
          <div
            key={item.id}
            data-slot="card"
            data-state={isSelected ? 'selected' : undefined}
            data-just-installed={skill && item.justInstalled ? 'true' : undefined}
            className={cn(
              'onhover-container from-muted/70 to-card relative flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-gradient-to-t p-4 text-left',
              'hover:border-muted-foreground/40 transition-[box-shadow,border-color,background-color] hover:shadow-md',
              'data-[state=selected]:bg-muted/50 data-[state=selected]:bg-none'
            )}
            onClick={() => openItem(item)}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="选择"
              onClick={(event) => event.stopPropagation()}
              className={cn('onhover-visible bg-background absolute top-2 left-2 z-40', isSelected && 'opacity-100!')}
            />

            <div className="absolute top-2 right-2 z-30">
              <ModuleCardActions module={module} item={item} />
            </div>

            {/* O-8：左上多选框（hover 或勾选时常显）右缘距卡片内容仅约 8px，标题首字符会被遮挡；
                标题行容器整体右移 12px（pl-3）留出约 4px 净空、下移 2px（pt-0.5）与多选框视觉找齐（PRD 实测 pl-2 净空为 0px）。
                 O-13：标题 + 来源区固定 3rem 槽位（min-h-12），无链接也占位；标题行不换行（flex-nowrap）：
                标题可压缩省略（flex: 0 1 auto + min-width: 0），来源 / 更新徽章不参与压缩（shrink-0）固定同行右侧 */}
            <div className="flex min-h-12 min-w-0 flex-col gap-1 pt-0.5 pl-3">
              <div className="flex flex-nowrap items-center gap-1.5 pr-20">
                <h4 className="min-w-0 flex-[0_1_auto] truncate font-semibold tracking-tight">
                  {moduleConfig.titleOf(item)}
                </h4>
                {skill && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <SourceBadge sourceType={item.source_type} />
                    {item.hasUpdate && <UpdateBadge />}
                  </span>
                )}
              </div>
              {showLink &&
                (skill ? (
                  <ItemSourceLine
                    text={item.source_url || '本地上传'}
                    href={
                      item.source_type === 'github' && item.source_url
                        ? normalizedSourceURL(item.source_url)
                        : undefined
                    }
                  />
                ) : account ? null : ( // 账号有独立的 Account* 布局（PRD §9.3），这里只保证类型完备
                  <ItemSourceLine text={item.url} href={normalizedSourceURL(item.url)} />
                ))}
            </div>

            {/* O-13：描述区固定 3rem 槽位（min-h-12），字段可见但无描述时保留空槽，保证多张卡片纵向对齐；
                用户主动隐藏 description 字段时整块不渲染、槽位收缩 */}
            {showDescription && !account && (
              <div className="min-h-12">
                {item.description ? (
                  <p className="text-muted-foreground line-clamp-2 text-sm leading-6 wrap-anywhere">
                    {item.description}
                  </p>
                ) : null}
              </div>
            )}

            {/* O-13：标签区固定 1.625rem 槽位（min-h-[26px]），无标签保留空槽、主动隐藏字段时槽位收缩；
                标签超过一行时允许撑高，底部由 mt-auto 继续贴底 */}
            {showTags && (
              <div className="flex min-h-[26px] flex-wrap items-center gap-1">
                {tagIDs.map((tagID) => (
                  <span key={tagID} onClick={(event) => event.stopPropagation()}>
                    <TagBadge tagID={tagID} />
                  </span>
                ))}
              </div>
            )}

            {/* O-13：底部署名区固定 1.75rem 槽位（min-h-7）并 mt-auto 贴卡片底部；
                组成字段（安装时间 / 指纹 / 创建时间）全部隐藏时整槽不渲染 */}
            {(footerLeft || footerRight) && (
              <div className="text-muted-foreground mt-auto flex min-h-7 items-center justify-between gap-3 border-t pt-2 text-[11px]">
                {footerLeft ? (
                  <span className={cn('min-w-0 truncate', skill && 'font-mono')} title={footerLeft}>
                    {footerLeft}
                  </span>
                ) : null}
                {footerRight ? <span className="ml-auto shrink-0">{footerRight}</span> : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
