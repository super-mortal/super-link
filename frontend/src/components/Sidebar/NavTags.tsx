import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { IconDotsVertical } from '@tabler/icons-react';

import { SidebarMenu, useSidebar } from '@/components/ui/sidebar.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { SidebarSection } from '@/components/Sidebar/SidebarSection.tsx';
import { SidebarTag } from '@/components/Sidebar/SidebarTag.tsx';
import { PreferencesStoreContext, StoreContext } from '@/store/storeContext.ts';
import { TagType } from '@/lib/types.ts';
import { MODULES } from '@/lib/modules.ts';
import { SIDEBAR_SECTION_ACTION_CLASS } from '@/lib/sidebarRow.ts';

export const NavTags = observer(({ itemIDsByTagID }: { itemIDsByTagID: Record<string, number[]> }) => {
  const store = React.useContext(StoreContext);
  const prefStore = React.useContext(PreferencesStoreContext);
  const selectedTag = store.tags[store.tagFilter] ?? null;
  const { isMobile } = useSidebar();

  const allTags = useMemo(() => {
    const tags = [...store.tagsArray];
    tags.sort((a, b) => {
      if (a.pinned && !b.pinned) {
        return -1;
      }
      if (!a.pinned && b.pinned) {
        return 1;
      }
      return 0;
    });
    return tags;
  }, [store.tagsArray]);

  const renderTag = useCallback(
    // depth：0 = 一级标签，每往下一级 +1；SidebarTag 据此压缩缩进（PRD O-10）
    (parentID: number, depth = 0): [React.JSX.Element[], number[]] => {
      const renderedTags: React.JSX.Element[] = [];
      const tags: TagType[] = allTags.filter((tag: TagType) => tag.parent === parentID) as TagType[];

      let levelItemIDs = [];

      for (const tag of tags) {
        const isTagSelected = store.tagFilter === tag.id;
        const isChildTagSelected = !isTagSelected && selectedTag && selectedTag.fullPath.indexOf(tag.fullPath) === 0;

        const currentTagItemIDs = itemIDsByTagID[tag.id] ?? [];
        const [renderedChildTags, childTagsItemIDs] = renderTag(tag.id, depth + 1);
        // Ensure we don't double count items that are assigned multiple child tags and/or current tag and child tags
        const accountedItemIDs = new Set([
          ...currentTagItemIDs,
          ...(prefStore.includeNestedTagItems ? childTagsItemIDs : []),
        ]);
        levelItemIDs = [...levelItemIDs, ...accountedItemIDs];

        renderedTags.push(
          <SidebarTag
            key={tag.id}
            tag={tag}
            depth={depth}
            renderedChildTags={renderedChildTags}
            itemCount={accountedItemIDs.size}
            isTagSelected={isTagSelected}
            isChildTagSelected={isChildTagSelected}
          />
        );
      }

      return [renderedTags, levelItemIDs];
    },
    [allTags, selectedTag, store.tagFilter, prefStore.includeNestedTagItems, itemIDsByTagID]
  );
  const [renderedTagTree] = renderTag(0);

  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={SIDEBAR_SECTION_ACTION_CLASS}>
          <IconDotsVertical />
          <span className="sr-only">更多</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="rounded-lg"
        side={isMobile ? 'bottom' : 'right'}
        align={isMobile ? 'end' : 'start'}
      >
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={prefStore.includeNestedTagItems}
            onCheckedChange={(value) => prefStore.setIncludeNestedTagItems(value)}
          >
            <span>包含嵌套标签的{MODULES[store.module].noun}</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={prefStore.displaySidebarTagItemCounts}
            onCheckedChange={(value) => prefStore.setDisplaySidebarTagItemCounts(value)}
          >
            <span>显示项目数量</span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <SidebarSection label={MODULES[store.module].sectionLabel} more={moreMenu}>
      {/* 不再渲染「全部」行（PRD O-14）：无筛选时列表无高亮，点标签写入筛选、再点同一项取消 */}
      <SidebarMenu>{renderedTagTree}</SidebarMenu>
    </SidebarSection>
  );
});
