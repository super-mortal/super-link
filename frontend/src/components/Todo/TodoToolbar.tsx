import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { LayoutGrid, LayoutList, ListTodo, SearchIcon, X } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { MODULES } from '@/lib/modules.ts';
import { LayoutType } from '@/lib/types.ts';
import { useUrlState } from '@/hooks/useUrlState.ts';

/** 待办只支持列表 / 卡片两种布局（PRD §5.1 / T3），这里按 key 取图标与无障碍文案 */
const LAYOUT_META: Partial<Record<LayoutType, { label: string; icon: ComponentType<{ className?: string }> }>> = {
  list: { label: '列表', icon: LayoutList },
  cards: { label: '卡片', icon: LayoutGrid },
};

type TodoToolbarProps = {
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  /**
   * 搜索关键词实时变化：外壳据此隐藏快速录入（PRD §5.2）。
   * 关键词本身写 URL 有 300ms 去抖，这里同步回调让显隐立即生效。
   */
  onSearchChange?: (value: string) => void;
};

/**
 * 待办工具栏（PRD §5.1 / §5.7）：侧栏开关 + 搜索框 + 列表 / 卡片切换。
 *
 * 搜索态由本组件持有并同步到 URL 的 `search` 参数（与书签 / Skill 的同步方式一致：
 * URL → 输入框、输入框 → URL 300ms 去抖）；待办不写 tag / page / sort 等列表参数。
 */
export const TodoToolbar = ({ layout, onLayoutChange, onSearchChange }: TodoToolbarProps) => {
  const layouts = MODULES.todos.layouts ?? [];
  const { searchParams, setUrlState } = useUrlState();
  const searchKeywordParam = searchParams.get('search') ?? '';
  const [search, setSearch] = useState(searchKeywordParam);

  // URL → 输入框：进入待办模块时上层会清掉旧模块的列表参数，这里跟随 URL 回填
  useEffect(() => {
    if (search === searchKeywordParam) {
      return;
    }
    setSearch(searchKeywordParam);
    onSearchChange?.(searchKeywordParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKeywordParam]);

  // 输入框 → URL（300ms 去抖）：待办只写 search，不写 page / tag 等参数
  useEffect(() => {
    if (search === searchKeywordParam) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setUrlState({ search });
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearchChange?.(value);
  };

  return (
    <header className="bg-background sticky top-0 z-50 flex h-14 w-full items-center gap-1.5 border-b px-4">
      <SidebarToggler />
      <ListTodo className="h-4 w-4" />
      <span className="text-sm font-medium">{MODULES.todos.label}</span>

      <InputGroup className="ml-1 max-w-72 min-w-0 flex-1">
        <InputGroupInput
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          onKeyDown={(event) => {
            // Esc 清空搜索：与清除按钮同一路径，恢复分段 + 折叠布局并同步清理 URL
            if (event.key === 'Escape') {
              handleSearchChange('');
            }
          }}
          name="todo-search"
          className="h-9 pl-6"
          placeholder="搜索待办..."
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        {search.length > 0 && (
          <InputGroupAddon align="inline-end" onClick={() => handleSearchChange('')}>
            <InputGroupButton aria-label="清除搜索">
              <X className="mt-[1px]" /> <Kbd className="pointer-coarse:hidden">Esc</Kbd>
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      <div className="ml-auto flex items-center gap-1.5">
        <ToggleGroup
          variant="outline"
          type="single"
          value={layout}
          onValueChange={(value: LayoutType) => value && onLayoutChange(value)}
        >
          {layouts.map((key) => {
            const meta = LAYOUT_META[key];
            if (!meta) {
              return null;
            }
            const Icon = meta.icon;

            return (
              <ToggleGroupItem key={key} value={key} aria-label={meta.label}>
                <Icon />
                <span className="hidden @xl/main:inline-block">{meta.label}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
    </header>
  );
};
