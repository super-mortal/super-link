import * as React from 'react';

import { SidebarMenuItem } from '@/components/ui/sidebar.tsx';
import { cn } from '@/lib/utils.ts';
import {
  SIDEBAR_ROW_ACTION_OFFSET_CLASS,
  SIDEBAR_ROW_ACTION_WRAPPER_CLASS,
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_COUNT_CLASS,
  SIDEBAR_ROW_DOT_CLASS,
  SIDEBAR_ROW_SLOT_CLASS,
} from '@/lib/sidebarRow.ts';

type SidebarFilterRowProps = {
  /** 行名称（标签 / 平台名 / 分组名） */
  label: string;
  /** 右侧计数；不传则不占位 */
  count?: number;
  /** 颜色点类名（标签 getColorClass / 平台品牌色 / 分组固定映射）；不传则不渲染色点 */
  dotClass?: string;
  /** 左侧 1.5rem 槽位内容（标签 chevron）；平台 / 分组不传，槽位仍保留保证名称左对齐 */
  leading?: React.ReactNode;
  /** 父标签：500 字重（refinements.md §2.2） */
  isParent?: boolean;
  /** 选中态：浅色底 + 主色文字，无左侧色条（与模块行的实心选中区分） */
  isActive?: boolean;
  /** 右侧 hover 动作（三点菜单）；不传则计数常显、不出现三点（平台 / 分组暂无线级操作） */
  action?: React.ReactNode;
  onClick?: () => void;
  /** 悬停提示，默认取 label */
  title?: string;
};

/**
 * 侧栏筛选行：标签 / 平台 / 分组共用（refinements.md §2.2）。
 *
 * 几何尺寸全部取自 lib/sidebarRow.ts，调用方不要再写数值。
 * 行内结构：[1.5rem 左槽][色点][名称][右侧计数 / 三点]；有 action 时 hover 行内隐藏计数，
 * 三点按钮中心与计数中心对齐（右偏移 -0.25rem）。
 */
export const SidebarFilterRow = ({
  label,
  count,
  dotClass,
  leading,
  isParent = false,
  isActive = false,
  action,
  onClick,
  title,
}: SidebarFilterRowProps) => {
  const hasAction = action != null;

  return (
    <SidebarMenuItem>
      <button
        type="button"
        onClick={onClick}
        title={title ?? label}
        aria-pressed={isActive}
        className={cn(
          SIDEBAR_ROW_CLASS,
          isActive && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary font-medium'
        )}
      >
        <span className={SIDEBAR_ROW_SLOT_CLASS}>{leading}</span>
        {dotClass && <span className={cn(SIDEBAR_ROW_DOT_CLASS, dotClass)} aria-hidden="true" />}
        <span className={cn('line-clamp-1 min-w-0 flex-1 break-all', isParent && 'font-medium')}>{label}</span>
        {count !== undefined && (
          <span
            className={cn(
              SIDEBAR_ROW_COUNT_CLASS,
              hasAction && 'group-hover/row:invisible',
              isActive && 'text-primary'
            )}
          >
            {count}
          </span>
        )}
      </button>

      {hasAction && (
        <div className={cn(SIDEBAR_ROW_ACTION_WRAPPER_CLASS, SIDEBAR_ROW_ACTION_OFFSET_CLASS)}>{action}</div>
      )}
    </SidebarMenuItem>
  );
};
