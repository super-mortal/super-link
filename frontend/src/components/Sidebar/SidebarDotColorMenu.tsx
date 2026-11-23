import * as React from 'react';
import { IconDotsVertical } from '@tabler/icons-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { SIDEBAR_ROW_ACTION_CLASS } from '@/lib/sidebarRow.ts';
import { sidebarDotColors, SidebarDotScope } from '@/lib/sidebarDotColor.ts';
import { cn, colorMap } from '@/lib/utils.ts';

type SidebarDotColorMenuProps = {
  scope: SidebarDotScope;
  /** 平台名 / 分组名：作为偏好键 */
  name: string;
};

/** colorMap 里有一个历史遗留的 'white ' 键（带尾空格），展示与比较前统一 trim */
const colorLabel = (color: string) => {
  const name = color.trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/**
 * 平台行 / 分组行的三点菜单（refinements.md §2.2）。
 *
 * 与标签行不同，这两类行没有「编辑 / 删除 / 置顶」，只提供色点颜色：
 * 展开调色板（与标签同一份 colorMap）或恢复默认颜色。
 * 色板经 DropdownMenuPortal 挂到 body，父菜单的 overflow / max-height 不会裁剪它。
 */
export const SidebarDotColorMenu = ({ scope, name }: SidebarDotColorMenuProps) => {
  const current = sidebarDotColors.get(scope, name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(SIDEBAR_ROW_ACTION_CLASS, 'cursor-pointer')}>
          <IconDotsVertical />
          <span className="sr-only">更多</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-40 rounded-lg">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>颜色</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              {Object.keys(colorMap).map((color) => (
                <DropdownMenuItem key={color} onClick={() => sidebarDotColors.set(scope, name, color)}>
                  <span
                    className={cn('mr-1 inline-block size-3 rounded-full', colorMap[color as keyof typeof colorMap])}
                  />
                  {colorLabel(color)}
                  <span className="ml-auto">{current === color ? '✓' : ''}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem disabled={!current} onClick={() => sidebarDotColors.set(scope, name, null)}>
          恢复默认颜色
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
