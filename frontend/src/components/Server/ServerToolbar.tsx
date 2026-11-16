import type { KeyboardEvent } from 'react';
import { ArrowDownUp, Check, PlusIcon, SearchIcon, ServerCog, X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { SERVER_SORTS } from '@/lib/serverFormat.ts';
import { cn } from '@/lib/utils.ts';

type ServerToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  /** 「字段-方向」合一写法（SERVER_SORTS 的 value），拆分见 parseServerSort */
  sortKey: string;
  onSortChange: (value: string) => void;
  onAdd: () => void;
};

/**
 * 服务器列表工具栏（PRD §5.5，原型 serverToolbarHtml）。
 *
 * 搜索在已加载的全量数据上即时过滤（store.filterServers，名称 / 备注 / IP），
 * 不必每敲一个字都发一次请求；Esc 清空是明确修复点——早期实现只清了输入框、
 * 没清筛选条件，出现「框是空的、列表仍处于过滤中」的观感。
 */
export const ServerToolbar = ({ search, onSearchChange, sortKey, onSortChange, onAdd }: ServerToolbarProps) => {
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      onSearchChange('');
    }
  };

  return (
    <header className="bg-background sticky top-0 z-50 flex h-14 w-full items-center gap-1.5 border-b px-4">
      <SidebarToggler />
      <ServerCog className="h-4 w-4" />
      <span className="text-sm font-medium">服务器</span>

      <InputGroup className="ml-1 max-w-72 min-w-0 flex-1">
        <InputGroupInput
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          name="server-search"
          placeholder="搜索名称、备注或 IP..."
          className="h-9 pl-6"
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        {search.length > 0 && (
          <InputGroupAddon align="inline-end" onClick={() => onSearchChange('')}>
            <InputGroupButton>
              <X className="mt-[1px]" /> <Kbd className="pointer-coarse:hidden">Esc</Kbd>
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <ArrowDownUp />
              <span className="hidden @xl/main:inline-block">排序</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="min-w-40">
            <DropdownMenuLabel>排序</DropdownMenuLabel>
            {SERVER_SORTS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => onSortChange(option.value)}
                className={cn('flex justify-between', option.value === sortKey && 'bg-accent')}
              >
                <span>{option.label}</span>
                {option.value === sortKey && <Check className="text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* onAdd 目前只置位添加弹窗 state：完整弹窗（名称 / 备注 / 分组 + Token 与安装命令一次性展示）属 task15，
            store.createServer 已就绪（task9），届时在本按钮的 onOpenChange 上挂 ServerFormDialog 即可 */}
        <Button variant="default" onClick={onAdd}>
          <PlusIcon />
          <span className="hidden @xl/main:inline-block">添加服务器</span>
        </Button>
      </div>
    </header>
  );
};
