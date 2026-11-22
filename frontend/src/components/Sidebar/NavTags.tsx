import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
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
  const [tagSearchValue, setTagSearchValue] = useState('');
  const { isMobile } = useSidebar();

  // Skills 模块不提供标签搜索入口（refinements.md §3）：搜索动作不传，由外壳渲染同尺寸不可见占位，
  // 保留「更多」菜单（包含嵌套 / 显示数量），动作位顺序与书签一致
  const canSearchTags = store.module !== 'skills';

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

  const [isTagSearchVisible, setIsTagSearchVisible] = useState(false);

  const hideTagSearch = () => {
    setTagSearchValue('');
    setIsTagSearchVisible(false);
  };

  const showTagSearch = () => {
    setIsTagSearchVisible(true);
  };

  // 搜索态下切到 Skills：清空并收起搜索，避免遗留关键词继续过滤标签树
  React.useEffect(() => {
    if (!canSearchTags) {
      setTagSearchValue('');
      setIsTagSearchVisible(false);
    }
  }, [canSearchTags]);

  const renderTag = useCallback(
    // depth：0 = 一级标签，每往下一级 +1；SidebarTag 据此压缩缩进（PRD O-10）
    (
      parentID: number,
      depth = 0,
      threadItemIDs = [],
      threadMatchesSearch = false
    ): [React.JSX.Element[], number[], boolean] => {
      const renderedTags: React.JSX.Element[] = [];
      const tags: TagType[] = allTags.filter((tag: TagType) => tag.parent === parentID) as TagType[];

      let levelItemIDs = [];
      let levelTagsMatchSearch = false;

      for (const tag of tags) {
        const isTagSelected = store.tagFilter === tag.id;
        const isChildTagSelected = !isTagSelected && selectedTag && selectedTag.fullPath.indexOf(tag.fullPath) === 0;

        const isTagSearchActive = tagSearchValue !== '';
        const currentTagMatchesSearch =
          isTagSearchActive && tag.title.toLowerCase().includes(tagSearchValue.toLowerCase());

        const currentTagItemIDs = itemIDsByTagID[tag.id] ?? [];
        const [renderedChildTags, childTagsItemIDs, childTagsMatchSearch] = renderTag(
          tag.id,
          depth + 1,
          [...threadItemIDs, ...currentTagItemIDs],
          threadMatchesSearch || currentTagMatchesSearch
        );
        // Ensure we don't double count items that are assigned multiple child tags and/or current tag and child tags
        const accountedItemIDs = new Set([
          ...currentTagItemIDs,
          ...(prefStore.includeNestedTagItems ? childTagsItemIDs : []),
        ]);
        levelItemIDs = [...levelItemIDs, ...accountedItemIDs];

        if (!isTagSearchActive || currentTagMatchesSearch || childTagsMatchSearch || threadMatchesSearch) {
          const renderedTag = (
            <SidebarTag
              key={tag.id}
              tag={tag}
              depth={depth}
              renderedChildTags={renderedChildTags}
              itemCount={accountedItemIDs.size}
              isTagSelected={isTagSelected}
              isChildTagSelected={isChildTagSelected}
              childTagsMatchSearch={childTagsMatchSearch}
              highlightText={currentTagMatchesSearch ? tagSearchValue : null}
            />
          );
          renderedTags.push(renderedTag);
        }

        if (currentTagMatchesSearch || childTagsMatchSearch) {
          levelTagsMatchSearch = true;
        }
      }

      return [renderedTags, levelItemIDs, levelTagsMatchSearch];
    },
    [allTags, selectedTag, store.tagFilter, prefStore.includeNestedTagItems, itemIDsByTagID, tagSearchValue]
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
    <SidebarSection
      label={MODULES[store.module].sectionLabel}
      onSearch={canSearchTags ? showTagSearch : undefined}
      more={moreMenu}
      isSearching={canSearchTags && isTagSearchVisible}
      searchValue={tagSearchValue}
      onSearchChange={setTagSearchValue}
      onSearchClose={hideTagSearch}
      searchPlaceholder="筛选标签..."
    >
      {/* 不再渲染「全部」行（PRD O-14）：无筛选时列表无高亮，点标签写入筛选、再点同一项取消 */}
      <SidebarMenu>{renderedTagTree}</SidebarMenu>
    </SidebarSection>
  );
});
