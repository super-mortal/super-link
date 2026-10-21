import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { flexRender } from '@tanstack/react-table';
import * as React from 'react';
import { cn } from '@/lib/utils.ts';
import type { ModuleTableLayoutProps } from '@/components/Table/Layouts/layoutTypes.ts';

/**
 * 表格布局：列集合 = 固定列（多选 / 标题 / 操作）+ MODULES.fields（在 ModuleList 中推导）。
 * 这里再用 visibleFields 兜底过滤可隐藏列，保证字段勾选与渲染结果始终一致。
 */
export const TableLayout = ({ table, rows, visibleFields }: ModuleTableLayoutProps) => {
  const shouldRenderColumn = (columnId: string) => {
    const column = table.getColumn(columnId);
    if (!column || !column.getCanHide()) {
      return true;
    }
    return visibleFields.includes(columnId);
  };

  return (
    <div className="bg-card m-4 overflow-hidden rounded-lg border">
      <Table className="w-full text-[13px]">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers
                .filter((header) => shouldRenderColumn(header.column.id))
                .map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'text-muted-foreground px-4 py-2.5 text-xs font-medium',
                        header.column.columnDef.meta?.class || ''
                      )}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? 'selected' : undefined}
              className="onhover-container"
            >
              {row
                .getVisibleCells()
                .filter((cell) => shouldRenderColumn(cell.column.id))
                .map((cell) => {
                  const isPinned = cell.column.columnDef.meta?.isPinned ?? false;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'px-4 py-2.5 text-left align-middle break-normal whitespace-normal',
                        cell.column.columnDef.meta?.class || '',
                        isPinned && 'bg-card sticky right-0 z-10'
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
