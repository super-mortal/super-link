import * as React from 'react';
import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input.tsx';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from '@/components/ui/sidebar.tsx';
import { cn } from '@/lib/utils.ts';
import {
  SIDEBAR_SECTION_ACTION_CLASS,
  SIDEBAR_SECTION_GROUP_CLASS,
  SIDEBAR_SECTION_HEADER_CLASS,
  SIDEBAR_SECTION_SEARCH_CLASS,
} from '@/lib/sidebarRow.ts';

type SidebarSectionProps = {
  /** 分区标题：书签「标签」、Skill「分类」、账号库「标签」、服务器「分组」 */
  label: React.ReactNode;
  /** 头部「搜索」动作；不传则渲染不可见占位（Skills 不显示标签搜索，位置仍与其他模块一致） */
  onSearch?: () => void;
  /** 头部「更多」菜单（整个 DropdownMenu）；触发器请用 SIDEBAR_SECTION_ACTION_CLASS，不传渲染不可见占位 */
  more?: React.ReactNode;
  /** 搜索态：输入框替换头部，高度同为 2rem，列表起始位置不变 */
  isSearching?: boolean;
  /** 搜索输入内容（受控） */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** 退出搜索：点 X 或按 Esc；不传则不渲染关闭按钮 */
  onSearchClose?: () => void;
  searchPlaceholder?: string;
  /** 列表体：SidebarMenu + SidebarFilterRow（或标签树） */
  children: React.ReactNode;
  className?: string;
};

/**
 * 侧栏第二区统一外壳（refinements.md §2.1）。
 *
 * 结构固定为：分区容器（上边框 + 0.5rem 上内边距）→ 头部（2rem，标题 + 固定动作位）→ 列表体。
 * 搜索态用同高输入框替换头部，保证切换模块 / 开关搜索时列表起始位置不跳动；
 * 缺失的动作渲染同尺寸不可见占位，动作位顺序恒为「搜索」「更多」。
 */
export const SidebarSection = ({
  label,
  onSearch,
  more,
  isSearching = false,
  searchValue,
  onSearchChange,
  onSearchClose,
  searchPlaceholder = '搜索...',
  children,
  className,
}: SidebarSectionProps) => {
  return (
    <SidebarGroup className={cn(SIDEBAR_SECTION_GROUP_CLASS, className)}>
      {isSearching ? (
        <div className={SIDEBAR_SECTION_SEARCH_CLASS}>
          <Search className="text-muted-foreground pointer-events-none absolute left-2 size-4" aria-hidden="true" />
          <Input
            autoFocus
            name="search"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange?.(String(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onSearchClose?.();
              }
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8 ps-7 pe-8 text-sm"
          />
          {onSearchClose && (
            <button
              type="button"
              onClick={onSearchClose}
              aria-label="退出搜索"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute right-1 flex size-5 items-center justify-center rounded-md"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <div className={SIDEBAR_SECTION_HEADER_CLASS}>
          <SidebarGroupLabel className="me-auto px-2">{label}</SidebarGroupLabel>
          {onSearch ? (
            <button type="button" onClick={onSearch} className={SIDEBAR_SECTION_ACTION_CLASS}>
              <Search />
              <span className="sr-only">搜索</span>
            </button>
          ) : (
            <span className={cn(SIDEBAR_SECTION_ACTION_CLASS, 'invisible')} aria-hidden="true" />
          )}
          {more ?? <span className={cn(SIDEBAR_SECTION_ACTION_CLASS, 'invisible')} aria-hidden="true" />}
        </div>
      )}

      <SidebarGroupContent className="flex flex-col gap-2">{children}</SidebarGroupContent>
    </SidebarGroup>
  );
};
