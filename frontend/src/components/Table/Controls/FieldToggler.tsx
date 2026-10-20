import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu.tsx';
import * as React from 'react';

export const FieldToggler = ({ columns, onChange }: { columns: any; onChange: any }) => {
  return columns.map((column) => {
    return (
      <DropdownMenuCheckboxItem
        key={column.id}
        className="capitalize"
        checked={column.getIsVisible()}
        onCheckedChange={(value) => onChange(column.id, value)}
        onSelect={(e) => e.preventDefault()}
      >
        <span>{column.columnDef.header}</span>
      </DropdownMenuCheckboxItem>
    );
  });
};
