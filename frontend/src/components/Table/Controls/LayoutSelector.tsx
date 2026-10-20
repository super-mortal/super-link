import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.tsx';
import { LayoutType } from '@/lib/types.ts';
import { LayoutGrid as CardsIcon, LayoutList, Table as TableIcon } from 'lucide-react';
import * as React from 'react';

export const LayoutSelector = ({ layout, onChange }: { layout: LayoutType; onChange: (val: LayoutType) => void }) => {
  return (
    <ToggleGroup
      variant="outline"
      type="single"
      value={layout}
      className="flex w-full justify-center"
      onValueChange={(value: LayoutType) => value && onChange(value)}
    >
      <ToggleGroupItem value="list" className="flex-1">
        <LayoutList />
      </ToggleGroupItem>
      <ToggleGroupItem value="cards" className="flex-1">
        <CardsIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" className="flex-1">
        <TableIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  );
};
