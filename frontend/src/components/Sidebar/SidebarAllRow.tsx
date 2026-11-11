import * as React from 'react';

import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * 侧栏标签 / 平台区顶部的「全部」入口（PRD O-10）。
 *
 * 与下方的标签树 / 平台列表之间用分隔线隔开；展示当前模块的条目总数，
 * 无筛选时默认高亮，点击清除筛选。按已确认决策不做「未标记」入口。
 */
export const SidebarAllRow = ({
  icon,
  count,
  isActive,
  onSelect,
}: {
  icon: React.ReactNode;
  count: number;
  isActive: boolean;
  onSelect: () => void;
}) => {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={onSelect} isActive={isActive} className="ps-2" title="全部">
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            className={cn(
              'flex size-4 flex-none items-center justify-center [&>svg]:size-3.5',
              isActive ? 'text-primary-foreground' : 'text-muted-foreground'
            )}
          >
            {icon}
          </span>
          <span className="font-medium">全部</span>
        </span>
      </SidebarMenuButton>
      <SidebarMenuBadge>{count}</SidebarMenuBadge>
    </SidebarMenuItem>
  );
};
