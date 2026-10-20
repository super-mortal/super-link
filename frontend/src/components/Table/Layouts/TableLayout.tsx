import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { flexRender } from '@tanstack/react-table';
import * as React from 'react';
import { cn } from '@/lib/utils.ts';

export const TableLayout = ({ table, rows }: { table: any; rows: any[] }) => {
  return (
    <Table className="w-full">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              return (
                <TableHead key={header.id} className={header.column.columnDef.meta?.class || ''}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'} className="onhover-container">
            {row.getVisibleCells().map((cell) => {
              const isPinned = cell.column.columnDef.meta?.isPinned ?? false;
              return (
                <TableCell
                  key={cell.id}
                  className={cn(
                    'text-left align-middle break-normal whitespace-normal',
                    cell.column.columnDef.meta?.class || '',
                    isPinned && 'sticky right-0 z-10 bg-transparent'
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
  );
};
