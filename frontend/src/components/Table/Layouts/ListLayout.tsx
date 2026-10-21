import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { cn } from '@/lib/utils.ts';
import { MODULES } from '@/lib/modules.ts';
import { TagBadge } from '@/components/Table/Fields/TagBadge.tsx';
import { ItemSourceLine, SourceBadge, UpdateBadge } from '@/components/Table/Fields/SourceBadge.tsx';
import { ModuleCardActions, useModuleItemOpen } from '@/components/Table/Fields/ModuleCardActions.tsx';
import { formatCardDate, isSkillItem, normalizedSourceURL, tagIDsOf } from '@/components/Table/Fields/moduleItem.ts';
import type { ModuleLayoutProps } from '@/components/Table/Layouts/layoutTypes.ts';

/**
 * 列表布局：字段竖排，复选框左侧垂直居中，操作按钮右上角绝对定位（与卡片共用同一套菜单）。
 * 与卡片一致，每个区块都由 visibleFields 门控，隐藏时不渲染也不占位。
 */
export const ListLayout = ({ rows, module, visibleFields }: ModuleLayoutProps) => {
  const moduleConfig = MODULES[module];
  const openItem = useModuleItemOpen(module);
  const visible = new Set(visibleFields);

  return (
    <div className="flex flex-col divide-y">
      {rows.map((row) => {
        const item = row.original;
        const isSelected = row.getIsSelected();
        const skill = isSkillItem(item);
        const tagIDs = tagIDsOf(item);

        const showLink = skill || visible.has('url');
        const showTags = visible.has('tags') && tagIDs.length > 0;
        const showDescription = visible.has('description') && Boolean(item.description);
        const showDate = visible.has(skill ? 'installed_at' : 'created_at');

        return (
          <div key={item.id} className="onhover-container relative">
            <div
              data-state={isSelected ? 'selected' : undefined}
              data-just-installed={skill && item.justInstalled ? 'true' : undefined}
              className="hover:bg-muted/30 data-[state=selected]:bg-muted/50 flex cursor-pointer flex-row items-start gap-4 px-8 py-6 transition-colors"
              onClick={() => openItem(item)}
            >
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left">
                <div className="flex flex-wrap items-center gap-1.5 pr-20">
                  <h4 className="min-w-0 truncate font-semibold tracking-tight">{moduleConfig.titleOf(item)}</h4>
                  {skill && <SourceBadge sourceType={item.source_type} />}
                  {skill && item.hasUpdate && <UpdateBadge />}
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
                  ) : (
                    <ItemSourceLine text={item.url} href={normalizedSourceURL(item.url)} />
                  ))}

                {showTags && (
                  <div className="flex flex-wrap items-center gap-1 py-0.5">
                    {tagIDs.map((tagID) => (
                      <span key={tagID} onClick={(event) => event.stopPropagation()}>
                        <TagBadge tagID={tagID} />
                      </span>
                    ))}
                  </div>
                )}

                {showDescription && (
                  <p className="text-muted-foreground line-clamp-2 text-sm leading-6 wrap-anywhere">
                    {item.description}
                  </p>
                )}

                {showDate && (
                  <div className="text-muted-foreground text-xs">
                    {moduleConfig.dateLabel}：{formatCardDate(moduleConfig.dateOf(item))}
                  </div>
                )}
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
              <ModuleCardActions module={module} item={item} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
