import * as React from 'react';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar.tsx';
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
import {
  SIDEBAR_ROW_ACTION_CLASS,
  SIDEBAR_ROW_ACTION_OFFSET_CLASS,
  SIDEBAR_ROW_COUNT_CLASS,
  SIDEBAR_ROW_COUNT_TOUCH_OFFSET_CLASS,
  SIDEBAR_ROW_DEEP_LEAF_INDENT_CLASS,
  SIDEBAR_ROW_DOT_CLASS,
  SIDEBAR_ROW_DOT_NESTED_CLASS,
  SIDEBAR_ROW_LEAF_INDENT_CLASS,
  SIDEBAR_ROW_SLOT_CLASS,
} from '@/lib/sidebarRow.ts';
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
  prependedNode = null,
  childTags = null,
  itemCount,
  isTagSelected,
  depth = 0,
  className,
}: {
  tag: TagType;
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

  // toggle 语义：点未选中的标签进入筛选，再点一次已选中的标签取消筛选（PRD O-12，
  // 筛选横幅已删除，侧栏高亮是唯一状态提示）；移动端点完收起侧栏
  const selectTag = () => {
    if (isEditOpen) {
      return;
    }
    setTagFilter(isTagSelected ? null : tag.id);
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
          // §2.2 名称对齐：父级用 1.5rem chevron 槽（见 prependedNode），叶子用同宽左内边距，
          // 两者名称因此左对齐；第三级起外层列表已缩进，内边距收到 0.75rem，避免深层标签逐级变窄
          prependedNode ? 'ps-0' : depth >= 2 ? SIDEBAR_ROW_DEEP_LEAF_INDENT_CLASS : SIDEBAR_ROW_LEAF_INDENT_CLASS,
          prefStore.displaySidebarTagItemCounts
            ? 'group-has-data-[sidebar=menu-action]/menu-item:pr-12 pointer-coarse:group-has-data-[sidebar=menu-action]/menu-item:pr-17'
            : 'group-has-data-[sidebar=menu-action]/menu-item:pr-8 pointer-coarse:group-has-data-[sidebar=menu-action]/menu-item:pr-8',
          className,
          // 选中态：浅色底 + 主色文字，无左侧色条（refinements.md §2.2，与 SidebarFilterRow 一致）；
          // 用 data-[active=true] 变体覆盖侧栏原语的实心选中，避免依赖类名顺序
          isTagSelected &&
            'data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:hover:bg-primary/15 data-[active=true]:hover:text-primary',
          isEditOpen ? 'bg-primary/5 pointer-events-none' : ''
        )}
      >
        {prependedNode}

        <div className={cn('flex w-full items-center gap-2')}>
          {/* 子级色点缩小，与父级 500 字重一起表达层级（PRD O-10）；尺寸取自共享行常量 */}
          <span
            className={cn(SIDEBAR_ROW_DOT_CLASS, depth !== 0 && SIDEBAR_ROW_DOT_NESTED_CLASS, getColorClass(tag.color))}
          ></span>

          <span title={tag.title} className={cn('line-clamp-1 break-all', prependedNode && 'font-medium')}>
            {tag.title}
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
        // 计数与 SidebarFilterRow 同一套几何（refinements.md §2.2）：距右 0.25rem / 11px / 透明度 0.8。
        // 不用 SidebarMenuBadge：原语自带 px-1，计数实际会离右 0.5rem，与共享行不一致。
        // 桌面端 hover 行或三点、菜单展开时隐藏计数给三点让位；触屏没有 hover，计数左移避让常显的三点
        <span
          className={cn(
            SIDEBAR_ROW_COUNT_CLASS,
            'pointer-fine:peer-hover/menu-action:hidden pointer-fine:peer-hover/menu-button:hidden',
            'pointer-fine:peer-data-[state=open]/menu-action:hidden',
            SIDEBAR_ROW_COUNT_TOUCH_OFFSET_CLASS,
            isTagSelected && 'text-primary'
          )}
        >
          {itemCount}
        </span>
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
              挂到 body，按钮自身的 transform 不会破坏菜单定位（原型里 .dd 容器加 transform 踩过的坑）。
              §2.2：右偏移 -0.25rem 让按钮中心与计数中心对齐，前景用 --foreground（比侧栏前景更深） */}
          <SidebarMenuAction
            showOnHover={true}
            className={cn(
              'top-1! scale-90 cursor-pointer pointer-coarse:scale-100',
              'peer-hover/menu-button:scale-100 hover:scale-100 data-[state=open]:scale-100',
              SIDEBAR_ROW_ACTION_CLASS,
              SIDEBAR_ROW_ACTION_OFFSET_CLASS,
              'text-foreground!',
              // 选中行是浅色底：图标换主色。按钮自身 hover / 菜单展开时会切到浅色圆底，
              // 前景必须用同等 important 的 hover 变体覆盖回 sidebar-accent-foreground——
              // important 的基础色会压过非 important 的 hover 变体，否则主色图标与强调底不同调
              isActive &&
                'text-primary! hover:text-sidebar-accent-foreground! data-[state=open]:text-sidebar-accent-foreground!'
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
            {/* 色板经 Portal 挂到 body：父菜单内容带 overflow-y-auto 与 max-h，不 Portal 会被裁掉；
                Radix Sub 打开时父级标签菜单保持打开，不会一闪即关（refinements.md §2.2） */}
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
  depth = 0,
}: {
  tag: TagType;
  renderedChildTags: React.ReactNode[];
  itemCount: number;
  isTagSelected: boolean;
  isChildTagSelected: boolean;
  /** 0 = 一级标签，每往下一级 +1；用于压缩缩进与子列表分隔线（PRD O-10） */
  depth?: number;
}) {
  const [isCollapsibleOpen, setIsCollapsibleOpen] = React.useState(isChildTagSelected);

  React.useEffect(() => {
    if (isChildTagSelected !== true || isChildTagSelected === isCollapsibleOpen) {
      return;
    }
    setIsCollapsibleOpen(isChildTagSelected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChildTagSelected]);

  const hasChildTags = renderedChildTags.length > 0;

  return hasChildTags ? (
    <Collapsible className="group/collapsible" open={isCollapsibleOpen}>
      <TagItem
        tag={tag}
        depth={depth}
        itemCount={itemCount}
        isTagSelected={isTagSelected}
        className={cn(isChildTagSelected && !isCollapsibleOpen ? 'bg-primary/10' : '', 'gap-0')}
        prependedNode={
          <div
            // §2.2：chevron 槽固定 1.5rem（与叶子行左内边距同宽，名称因此左对齐）；
            // 整槽可点、hover 有底色，点击只切换展开，不触发行选中
            className={cn(SIDEBAR_ROW_SLOT_CLASS, 'hover:bg-sidebar-accent cursor-pointer rounded-sm')}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsCollapsibleOpen(!isCollapsibleOpen);
            }}
          >
            <IconChevronRight className={cn('size-4 transition-transform', isCollapsibleOpen ? `rotate-90` : '')} />
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
    <TagItem tag={tag} depth={depth} itemCount={itemCount} isTagSelected={isTagSelected} />
  );
}
