import * as React from 'react';
import { renderField } from '@/components/Table/FieldFormatters.tsx';

export const ListLayout = ({ rows }) => {
  return (
    <div className="flex flex-col divide-y">
      {rows.map((row) => {
        return (
          <div
            key={row.original.id}
            data-state={row.getIsSelected() && 'selected'}
            className="onhover-container @container/item relative mx-2 transition-colors"
          >
            <div
              data-state={row.getIsSelected() && 'selected'}
              className="data-[state=selected]:bg-muted/50 -mx-2 flex h-full flex-row flex-nowrap gap-4 px-8 py-6 @xl/item:gap-6 @xl/item:px-10 @3xl/item:gap-12 @3xl/item:py-12"
            >
              <div className="flex h-full flex-2 flex-col items-start gap-1.5 text-left @xl/item:gap-3">
                {row.getVisibleCells().map((cell) => renderField({ cell }))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
