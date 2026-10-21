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
import type { ModuleSortType } from '@/lib/modules.ts';

export const Sorter: ({
  sorts,
  selectedSort,
  onChange,
}: {
  sorts: readonly ModuleSortType[];
  selectedSort: string;
  onChange: (sortKey: string) => void;
}) => JSX.Element = ({ sorts, selectedSort, onChange }) => {
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
        {sorts.map((sort) => (
          <DropdownMenuItem
            key={sort.key}
            onSelect={(event) => {
              // prevent the dropdown from closing on selection
              event.preventDefault();
              onChange(sort.key);
            }}
            className={'flex justify-between ' + (sort.key === selectedSort ? ' bg-accent' : '')}
          >
            <span>{sort.label}</span>
            <span>
              {sort.key === selectedSort &&
                (sort.order === 'desc' ? <ArrowDown className="text-primary" /> : <ArrowUp className="text-primary" />)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
