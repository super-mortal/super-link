import * as React from 'react';
import {
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar.tsx';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible.tsx';
import { IconChevronRight, IconDotsVertical, IconPinned } from '@tabler/icons-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { PreferencesStoreContext, StoreContext } from '@/store/storeContext.ts';
import { cn, colorMap, getColorClass } from '@/lib/utils.ts';
import { useItemListState } from '@/hooks/useItemListState.ts';
import { TagType } from '@/lib/types.ts';
import { DeleteTagDialog } from '@/components/Sidebar/DeleteTagDialog.tsx';
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader } from '@/components/ui/popover.tsx';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';
import { Info } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer.tsx';
import { TagSelect } from '@/components/EditItem/TagSelect.tsx';

const TagItem = ({
  tag,
  highlightText,
  prependedNode = null,
  childTags = null,
  itemCount,
  isTagSelected,
  depth = 0,
  className,
}: {
  tag: TagType;
  highlightText: string | null;
  prependedNode?: React.ReactNode;
  childTags?: React.ReactNode;
  itemCount: number;
  isTagSelected: boolean;
  /** 0 = 一级标签，每往下一级 +1；用于压缩缩进与缩小色点（PRD O-10） */
  depth?: number;
  className?: string;
}) => {
  const prefStore = React.useContext(PreferencesStoreContext);
  const { setTagFilter } = useItemListState();
  const { isMobile, toggleSidebar } = useSidebar();

  const [isEditOpen, setIsEditOpen] = React.useState(false);

  const selectTag = () => {
    if (isEditOpen) {
      return;
    }
    setTagFilter(tag.id);
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <SidebarMenuItem className="relative">
      <SidebarMenuButton
        onClick={selectTag}
        isActive={isTagSelected}
        className={cn(
          // O-10 缩进规则：一级（含二级）叶子固定左内边距 24px，第三级起收到 12px，
          // 配合外层列表收窄的边距，避免深层标签逐级变窄；父级由 chevron 提供缩进故不加左内边距
          prependedNode ? 'ps-0' : depth >= 2 ? 'ps-3' : 'ps-6',
          prefStore.displaySidebarTagItemCounts
            ? 'group-has-data-[sidebar=menu-action]/menu-item:pr-12 pointer-coarse:group-has-data-[sidebar=menu-action]/menu-item:pr-17'
            : 'group-has-data-[sidebar=menu-action]/menu-item:pr-8 pointer-coarse:group-has-data-[sidebar=menu-action]/menu-item:pr-8',
          className,
          isEditOpen ? 'bg-primary/5 pointer-events-none' : ''
        )}
      >
        {prependedNode}

        <div className={cn('flex w-full items-center gap-2')}>
          {/* 子级色点从 10px 缩到 8px，与父级 500 字重一起表达层级（PRD O-10） */}
          <span
            className={cn('flex-none rounded-full', depth === 0 ? 'size-2.5' : 'size-2', getColorClass(tag.color))}
          ></span>

          <span title={tag.title} className={cn('line-clamp-1 break-all', prependedNode && 'font-medium')}>
            {highlightText !== null
              ? tag.title.split(new RegExp(`(${highlightText})`, 'gi')).map((part, i) =>
                  part.toLowerCase() === highlightText.toLowerCase() ? (
                    <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-800">
                      {part}
                    </mark>
                  ) : (
                    part
                  )
                )
              : tag.title}
          </span>
          {tag.description && (
            <Tooltip>
              <TooltipTrigger asChild className="pointer-coarse:hidden">
                {/* 说明图标默认隐藏，仅 hover 当前行时淡入，弱化次要信息（PRD O-10） */}
                <Info className="h-3 w-3 opacity-0 transition-opacity group-hover/menu-item:opacity-50" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs whitespace-pre-wrap">{tag.description}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {tag.pinned && <IconPinned className="ms-auto h-4 w-4 flex-none" />}
        </div>
      </SidebarMenuButton>

      {childTags}

      <TagActions
        tag={tag}
        isEditOpen={isEditOpen}
        setIsEditOpen={setIsEditOpen}
        hasChildTags={childTags !== null}
        isActive={isTagSelected}
      />

      {prefStore.displaySidebarTagItemCounts && (
        // 选中行计数用主色前景（原型 .side-tag-row:has(.active) .side-tag-count）。
        // 注意用元素自身的 important，不要用 peer-data-[active=true]/menu-button: 变体——
        // 该变体会命中行内所有兄弟节点（包括三点按钮），与按钮的 hover 前景互相干扰
        <SidebarMenuBadge
          className={cn('text-[11px]! opacity-80 pointer-coarse:right-6', isTagSelected && 'text-primary-foreground!')}
        >
          {itemCount}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
};

const TagActions = ({ tag, isEditOpen, setIsEditOpen, hasChildTags, isActive }) => {
  const { isMobile } = useSidebar();
  const store = React.useContext(StoreContext);

  const deleteTag = () => {
    store.onDeleteTag(tag.id);
  };

  const showEditControls = () => {
    setIsEditOpen(true);
  };

  return (
    <>
      {isMobile ? (
        <Drawer open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>编辑标签</DrawerTitle>
            </DrawerHeader>

            <div className="mx-4 mb-4">
              <TagEditForm tag={tag} setIsEditOpen={setIsEditOpen} />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Popover open={isEditOpen} modal={true}>
          <PopoverAnchor className="absolute bottom-0 left-[--spacing]" />
          <PopoverContent align="start" sideOffset={2} className="w-md max-w-[100dvw]">
            <PopoverHeader className="mb-2 text-center">编辑标签</PopoverHeader>
            <TagEditForm tag={tag} setIsEditOpen={setIsEditOpen} />
          </PopoverContent>
        </Popover>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* O-10：24px 圆形热区，hover 当前行才淡入 + 轻微缩放；操作菜单经 DropdownMenuPortal
              挂到 body，按钮自身的 transform 不会破坏菜单定位（原型里 .dd 容器加 transform 踩过的坑） */}
          <SidebarMenuAction
            showOnHover={true}
            className={cn(
              'top-1! right-1! cursor-pointer rounded-full!',
              'size-6! scale-90 pointer-coarse:scale-100 [&>svg]:size-4.5!',
              'peer-hover/menu-button:scale-100 hover:scale-100 data-[state=open]:scale-100',
              // 选中行是深色底：图标换主色前景。按钮自身 hover / 菜单展开时会切到浅色圆底，
              // 前景必须用同等 important 的 hover 变体覆盖回 sidebar-accent-foreground——
              // important 的基础色会压过非 important 的 hover 变体，否则图标与浅底同色不可见
              isActive &&
                'text-primary-foreground! hover:text-sidebar-accent-foreground! data-[state=open]:text-sidebar-accent-foreground!'
            )}
          >
            <IconDotsVertical />
            <span className="sr-only">更多</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-24 rounded-lg"
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
        >
          <DropdownMenuItem onClick={showEditControls}>
            <span>编辑标签</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger> 颜色</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                {Object.keys(colorMap).map((color) => (
                  <DropdownMenuItem
                    key={color}
                    className={`text-${colorMap[color]}-foreground hover:bg-${colorMap[color]}-foreground/10`}
                    onClick={() => store.onChangeTagColor(tag.id, color)}
                  >
                    <span className={`mr-1 inline-block h-3 w-3 rounded-full ${colorMap[color]}`}></span>{' '}
                    {color.charAt(0).toUpperCase() + color.slice(1)}
                    <span className="ml-auto">{tag.color === color ? '✓' : ''}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => store.updateTagPinned(tag.id, !tag.pinned)}>
            <span>{tag.pinned ? '取消置顶' : '置顶'}标签</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={(e) => e.preventDefault()} className="p-0">
              <DeleteTagDialog onConfirm={deleteTag} hasChildTags={hasChildTags}>
                <span className="w-full px-2 py-1">删除</span>
              </DeleteTagDialog>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

const TagEditForm = ({ tag, setIsEditOpen }: { tag: TagType; setIsEditOpen: (bool) => void }) => {
  const store = React.useContext(StoreContext);
  const [isUpdateInProgress, setIsUpdateInProgress] = React.useState(false);

  const [newTagParent, setNewTagParent] = React.useState<number>(tag.parent);
  const [newTagTitle, setNewTagTitle] = React.useState<string>(tag.title);
  const [newTagDescription, setNewTagDescription] = React.useState<string>(tag.description);

  const hideEditControls = () => {
    setIsEditOpen(false);
  };

  const submit = async () => {
    setIsUpdateInProgress(true);
    const success = await store.updateTag(tag.id, newTagParent, newTagTitle, newTagDescription);
    setIsUpdateInProgress(false);
    if (!success) {
      return;
    }
    hideEditControls();
  };

  const revert = () => {
    setNewTagTitle(tag.fullPath);
    setNewTagDescription(tag.description);
    hideEditControls();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          revert();
        }
      }}
    >
      <FieldGroup className="gap-3" autoFocus={false}>
        <Field orientation="vertical" className="gap-1.5">
          <FieldLabel htmlFor="tag-name">父标签</FieldLabel>
          <TagSelect
            isMultiple={false}
            onChange={(tagID: number) => {
              setNewTagParent(tagID as number);
            }}
            selectedTagIDs={[newTagParent]}
            excludedTagIDs={[tag.id]}
          />
        </Field>
        <Field orientation="vertical" className="gap-1.5">
          <FieldLabel htmlFor="tag-name">标题</FieldLabel>
          <Input
            id="tag-name"
            autoComplete="off"
            value={newTagTitle as string}
            onChange={(e) => setNewTagTitle(e.target.value)}
          />
        </Field>
        <Field orientation="vertical" className="gap-1.5">
          <FieldLabel htmlFor="tag-description">描述</FieldLabel>
          <Textarea
            id="tag-description"
            value={newTagDescription as string}
            onChange={(e) => setNewTagDescription(e.target.value)}
          />
        </Field>
      </FieldGroup>
      <div className="flex flex-col-reverse gap-2 pt-4 md:flex-row md:justify-end">
        <Button type="reset" size="sm" onClick={revert} variant="secondary">
          取消
        </Button>
        <Button type="submit" size="sm" variant="default" disabled={isUpdateInProgress}>
          {isUpdateInProgress && <Spinner />}
          保存
        </Button>
      </div>
    </form>
  );
};

export function SidebarTag({
  tag,
  renderedChildTags,
  itemCount,
  isTagSelected,
  isChildTagSelected,
  childTagsMatchSearch,
  highlightText,
  depth = 0,
}: {
  tag: TagType;
  renderedChildTags: React.ReactNode[];
  itemCount: number;
  isTagSelected: boolean;
  isChildTagSelected: boolean;
  childTagsMatchSearch: boolean;
  highlightText: string | null;
  /** 0 = 一级标签，每往下一级 +1；用于压缩缩进与子列表分隔线（PRD O-10） */
  depth?: number;
}) {
  const [isCollapsibleOpen, setIsCollapsibleOpen] = React.useState(isChildTagSelected || childTagsMatchSearch);

  React.useEffect(() => {
    if (isChildTagSelected !== true || isChildTagSelected === isCollapsibleOpen) {
      return;
    }
    setIsCollapsibleOpen(isChildTagSelected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChildTagSelected]);

  React.useEffect(() => {
    if (childTagsMatchSearch !== true || childTagsMatchSearch === isCollapsibleOpen) {
      return;
    }
    setIsCollapsibleOpen(childTagsMatchSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childTagsMatchSearch]);

  const hasChildTags = renderedChildTags.length > 0;

  return hasChildTags ? (
    <Collapsible className="group/collapsible" open={isCollapsibleOpen}>
      <TagItem
        tag={tag}
        depth={depth}
        itemCount={itemCount}
        isTagSelected={isTagSelected}
        highlightText={highlightText}
        className={cn(isChildTagSelected && !isCollapsibleOpen ? 'bg-primary/10' : '', 'gap-0')}
        prependedNode={
          <div
            // chevron 热区扩大到 28px 并加 hover 背景（PRD O-10）；点击只切换展开，不触发行选中
            className="hover:bg-sidebar-accent cursor-pointer rounded-sm p-1.5"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsCollapsibleOpen(!isCollapsibleOpen);
            }}
          >
            <IconChevronRight className={cn('h-4 w-4 transition-transform', isCollapsibleOpen ? `rotate-90` : '')} />
          </div>
        }
        childTags={
          <CollapsibleContent>
            {/* O-10：每级一条左侧竖线表达层级；一级子列表缩进 8px + 6px，更深层级只保留
                4px + 4px 增量（按钮内边距同步收到 12px），避免深层标签越来越窄 */}
            <ul
              className={cn(
                'border-sidebar-border flex min-w-0 flex-col gap-1 border-l py-0.5',
                depth === 0 ? 'ms-2 ps-1.5' : 'ms-1 ps-1'
              )}
            >
              {renderedChildTags}
            </ul>
          </CollapsibleContent>
        }
      />
    </Collapsible>
  ) : (
    <TagItem
      tag={tag}
      depth={depth}
      itemCount={itemCount}
      highlightText={highlightText}
      isTagSelected={isTagSelected}
    />
  );
}
