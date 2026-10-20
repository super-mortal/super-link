import { Button } from '@/components/ui/button.tsx';
import { ArrowDown, ArrowDownUp, ArrowUp } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu.tsx';
import { DropdownMenuTrigger } from '@radix-ui/react-dropdown-menu';
import { JSX } from 'react';
import { ItemType } from '@/lib/types.ts';
import * as React from 'react';

export const Sorter: ({
  selectedSortColumn,
  isDesc,
  onChange,
  columns,
}: {
  selectedSortColumn: string | null;
  isDesc: boolean;
  onChange: any;
  columns: Array<any>;
}) => JSX.Element = ({ selectedSortColumn, isDesc, onChange, columns }) => {
  const handle = (columnId: keyof ItemType) => {
    let newIsDesc = isDesc;
    if (selectedSortColumn === columnId) {
      newIsDesc = !isDesc;
    }
    onChange(columnId, newIsDesc);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <ArrowDownUp />
          <span className="hidden @xl/main:inline-block">排序</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="min-w-40">
        <DropdownMenuLabel>排序</DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuItem
            key={column.id}
            onSelect={(event: any) => {
              // prevent the dropdown from closing on selection
              event.preventDefault();
              handle(column.id);
            }}
            className={'flex justify-between ' + (column.id === selectedSortColumn ? ' bg-accent' : '')}
          >
            <span>{column.columnDef.header}</span>
            <span>
              {column.id === selectedSortColumn &&
                (isDesc ? <ArrowDown className="text-primary" /> : <ArrowUp className="text-primary" />)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
