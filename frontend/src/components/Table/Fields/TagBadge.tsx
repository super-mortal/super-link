import React from 'react';
import { Badge } from '../../ui/badge.tsx';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '@/store/storeContext.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';
import { useItemListState } from '@/hooks/useItemListState.ts';
import { TagPath } from '@/components/EditItem/TagPath.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * 标签徽章加重样式：色底 + 描边 + 圆点。
 * 底色 / 描边 / 文字全部走 Tailwind 色阶与透明度，明暗主题共用一套语义，不写死 hex。
 */
const TAG_TONE_CLASS: Record<string, string> = {
  gray: 'border-gray-500/40 bg-gray-500/10 text-gray-700 dark:border-gray-400/30 dark:bg-gray-400/15 dark:text-gray-200',
  green:
    'border-green-600/40 bg-green-500/10 text-green-700 dark:border-green-400/30 dark:bg-green-400/15 dark:text-green-300',
  red: 'border-red-600/40 bg-red-500/10 text-red-700 dark:border-red-400/30 dark:bg-red-400/15 dark:text-red-300',
  yellow:
    'border-yellow-600/40 bg-yellow-500/10 text-yellow-700 dark:border-yellow-400/30 dark:bg-yellow-400/15 dark:text-yellow-300',
  aqua: 'border-blue-600/40 bg-blue-500/10 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/15 dark:text-blue-300',
  white:
    'border-neutral-400/50 bg-neutral-300/25 text-neutral-700 dark:border-neutral-500/40 dark:bg-neutral-400/15 dark:text-neutral-200',
  black:
    'border-neutral-900/30 bg-neutral-900/10 text-neutral-800 dark:border-neutral-100/25 dark:bg-neutral-100/10 dark:text-neutral-100',
};

const toneClassOf = (color: string | undefined) => TAG_TONE_CLASS[color?.trim() ?? ''] ?? TAG_TONE_CLASS.gray;

export const TagBadge: React.FC<{ tagID: number }> = observer(({ tagID }) => {
  const store = React.useContext(StoreContext);
  const tag = store.tags[tagID];
  const { setTagFilter } = useItemListState();

  if (!tag) {
    return null;
  }

  const isTagSelected = store.tagFilter === tagID;
  const isParentTagSelected =
    !isTagSelected && Array.isArray(store.itemListFilters.tags) && store.itemListFilters.tags.includes(tagID);
  const isActive = isTagSelected || isParentTagSelected;

  const setTag = () => {
    setTagFilter(tagID);
  };

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            'cursor-pointer gap-1.5 px-2 py-0.5 text-[11.5px] font-medium transition-colors',
            toneClassOf(tag.color),
            isActive && 'ring-foreground/25 ring-1'
          )}
          onClick={setTag}
        >
          <TagPath tag={{ label: tag.fullPath, color: tag.color }} showLast={true} />
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <TagPath tag={{ label: tag.fullPath, color: tag.color }} />
        {tag.description !== '' && <p className="mt-2 max-w-md whitespace-pre-wrap">{tag.description}</p>}
      </TooltipContent>
    </Tooltip>
  );
});
