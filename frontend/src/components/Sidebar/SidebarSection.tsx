import * as React from 'react';

import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from '@/components/ui/sidebar.tsx';
import { cn } from '@/lib/utils.ts';
import {
  SIDEBAR_SECTION_ACTION_CLASS,
  SIDEBAR_SECTION_GROUP_CLASS,
  SIDEBAR_SECTION_HEADER_CLASS,
} from '@/lib/sidebarRow.ts';

type SidebarSectionProps = {
  /** 分区标题：书签「标签」、Skill「分类」、账号库「平台」、服务器「分组」 */
  label: React.ReactNode;
  /** 头部「更多」菜单（整个 DropdownMenu）；触发器请用 SIDEBAR_SECTION_ACTION_CLASS，不传渲染不可见占位 */
  more?: React.ReactNode;
  /** 列表体：SidebarMenu + SidebarFilterRow（或标签树） */
  children: React.ReactNode;
  className?: string;
};

/**
 * 侧栏第二区统一外壳（refinements.md §2.1 / refinements-v0.1.2 §3.3）。
 *
 * 结构固定为：分区容器（上边框 + 0.5rem 上内边距）→ 头部（2rem，标题 + 动作位）→ 列表体。
 * 标签搜索按钮已在 refinements-v0.1.2 移除，头部只保留「更多」（其它分区不传则渲染同尺寸
 * 不可见占位），保证切换模块时列表起始位置不跳动。
 */
export const SidebarSection = ({ label, more, children, className }: SidebarSectionProps) => {
  return (
    <SidebarGroup className={cn(SIDEBAR_SECTION_GROUP_CLASS, className)}>
      <div className={SIDEBAR_SECTION_HEADER_CLASS}>
        <SidebarGroupLabel className="me-auto px-2">{label}</SidebarGroupLabel>
        {more ?? <span className={cn(SIDEBAR_SECTION_ACTION_CLASS, 'invisible')} aria-hidden="true" />}
      </div>

      <SidebarGroupContent className="flex flex-col gap-2">{children}</SidebarGroupContent>
    </SidebarGroup>
  );
};
