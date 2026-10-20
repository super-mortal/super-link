import * as React from 'react';
import { Card, CardContent } from '../../ui/card.tsx';
import { renderField } from '@/components/Table/FieldFormatters.tsx';

export const CardsLayout = ({ rows }) => {
  return (
    <div className="m-4 grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs @2xl/main:grid-cols-2 @5xl/main:grid-cols-3 @7xl/main:grid-cols-4 @min-[108rem]/main:grid-cols-5 @min-[126rem]/main:grid-cols-6 @min-[142rem]/main:grid-cols-7">
      {rows.map((row) => {
        return (
          <Card
            key={row.original.id}
            data-state={row.getIsSelected() && 'selected'}
            className="onhover-container data-[state=selected]:bg-muted/50 @container/item relative transition-colors"
          >
            <CardContent className="flex h-full flex-col gap-3 text-left">
              {row.getVisibleCells().map((cell) => renderField({ cell }))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
