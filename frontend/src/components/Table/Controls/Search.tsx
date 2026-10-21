'use client';

import type { Table } from '@tanstack/react-table';
import { SearchIcon, X } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { cn } from '@/lib/utils.ts';

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  /** 允许外层控制宽度，列表页用 flex-1 撑满中间区域 */
  className?: string;
}

export function Search<TData>({ table, globalFilter, className }: DataTableToolbarProps<TData>) {
  const isFiltered = globalFilter.length > 0;

  const updateSearch = (value: string) => {
    table.setGlobalFilter(value);
  };

  return (
    <InputGroup className={cn('flex-1', className)}>
      <InputGroupInput
        value={globalFilter ?? ''}
        onChange={(e) => updateSearch(String(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            updateSearch('');
          }
        }}
        name="search"
        className="h-9 pl-6"
        placeholder="搜索..."
      />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      {isFiltered && (
        <InputGroupAddon align="inline-end" onClick={() => updateSearch('')}>
          <InputGroupButton>
            <X className="mt-[1px]" /> <Kbd className="pointer-coarse:hidden">Esc</Kbd>
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
