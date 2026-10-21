'use client';

import * as React from 'react';
import { useContext, useMemo } from 'react';
import type { RowSelectionState, Table } from '@tanstack/react-table';
import { observer } from 'mobx-react-lite';
import { RefreshCw, Square, SquareCheckBig, SquareMinus, TagsIcon, Trash, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { Separator } from '@/components/ui/separator.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { TagSelect } from '@/components/Table/Controls/TagSelect.tsx';
import { isSkillItem, tagIDsOf } from '@/components/Table/Fields/moduleItem.ts';
import { StoreContext } from '@/store/storeContext.ts';
import { useIsMobile } from '@/hooks/use-mobile.ts';
import { MODULES, type ModuleItemType } from '@/lib/modules.ts';

type TagSelectionPayload = {
  newSelectedTagsAll: number[];
  newSelectedTagsSome: number[];
};

type BulkActionControlsProps = {
  table: Table<ModuleItemType>;
  rowSelection: RowSelectionState;
  /** 列表内容区容器节点：pill 以它的实测水平中心定位，侧栏拖拽 / 折叠后自动跟随 */
  contentElement?: HTMLElement | null;
};

/**
 * 底部居中的深色悬浮批量操作条，书签与 Skill 共用。
 *
 * 选中项为空即渲染 null：取消最后一项、点关闭、删除完成、切换模块、
 * 翻页 / 搜索 / 排序变化（列表页会重置行选择）都会即时消失。
 */
export const BulkActionControls = observer(({ table, rowSelection, contentElement }: BulkActionControlsProps) => {
  const isMobile = useIsMobile();
  const store = useContext(StoreContext);
  const module = store.module;
  const isSkillModule = module === 'skills';
  const moduleConfig = MODULES[module];

  const [deleteInProgress, setDeleteInProgress] = React.useState(false);
  const [fetchInProgress, setFetchInProgress] = React.useState(false);
  /** pill 的水平中心（视口坐标 px）。直接实测内容区，不假设侧栏宽度 */
  const [centerX, setCenterX] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (isMobile || !contentElement) {
      setCenterX(null);
      return;
    }

    const updateCenter = () => {
      const rect = contentElement.getBoundingClientRect();
      setCenterX(rect.left + rect.width / 2);
    };

    updateCenter();
    // 侧栏是可拖拽面板：拖拽 / 折叠 / 展开 / 窗口缩放都会改变内容区尺寸，统一以尺寸变化为准
    const resizeObserver = new ResizeObserver(updateCenter);
    resizeObserver.observe(contentElement);
    window.addEventListener('resize', updateCenter);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCenter);
    };
  }, [contentElement, isMobile]);

  const selectedRows = useMemo(() => table.getFilteredSelectedRowModel().rows, [rowSelection, table]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedRowsCount = selectedRows.length;
  const selectedRowIDs = useMemo(() => selectedRows.map((row) => row.original.id), [selectedRows]);

  const selectedTags = useMemo(() => selectedRows.flatMap((row) => tagIDsOf(row.original)), [selectedRows]);

  // 每个标签被多少个选中项持有：全部持有 = 全选态，部分持有 = 半选态
  const { selectedTagsAll, selectedTagsSome } = useMemo(() => {
    const countByTag = selectedTags.reduce<Record<number, number>>((count, tagID) => {
      count[tagID] = (count[tagID] ?? 0) + 1;
      return count;
    }, {});

    const all: number[] = [];
    const some: number[] = [];
    for (const [tagID, count] of Object.entries(countByTag)) {
      (count === selectedRowsCount ? all : some).push(Number(tagID));
    }

    return { selectedTagsAll: all, selectedTagsSome: some };
  }, [selectedTags, selectedRowsCount]);

  const deleteSelected = async () => {
    setDeleteInProgress(true);

    try {
      const isDeleted = isSkillModule
        ? await store.deleteSkills(selectedRowIDs)
        : (await store.deleteItems(selectedRowIDs)) !== null;

      if (!isDeleted) {
        return;
      }

      if (!isSkillModule) {
        await store.fetchItems();
      }
      table.resetRowSelection();
    } finally {
      setDeleteInProgress(false);
    }
  };

  const refetchSelected = async () => {
    setFetchInProgress(true);

    try {
      if (isSkillModule) {
        // 只把所选 ids 交给后端，未选中的行不参与检查
        const updates = await store.checkSkillUpdates(selectedRowIDs);
        if (updates === null) {
          return;
        }
        const updateCount = updates.length;
        const skippedCount = selectedRows.filter(
          (row) => isSkillItem(row.original) && row.original.source_type !== 'github'
        ).length;
        const skippedNote = skippedCount > 0 ? `（${skippedCount} 个上传来源已跳过）` : '';

        toast(
          updateCount > 0
            ? `所选 ${selectedRowsCount} 个 Skill 中有 ${updateCount} 个可更新${skippedNote}`
            : `所选 ${selectedRowsCount} 个 Skill 均为最新版本${skippedNote}`,
          { position: 'top-center' }
        );
        return;
      }

      const result = await store.refetchItemsMetadata(selectedRowIDs);
      if (result !== null) {
        await store.fetchItems();
      }
    } finally {
      setFetchInProgress(false);
    }
  };

  const updateTagsSelected = async ({ newSelectedTagsAll, newSelectedTagsSome }: TagSelectionPayload) => {
    if (!isSkillModule) {
      // 书签接口本身就是 all / some 语义，沿用原有调用方式
      const result = await store.updateItemsTags({
        itemIds: selectedRowIDs,
        newSelectedTagsAll: newSelectedTagsAll.map(String),
        newSelectedTagsSome: newSelectedTagsSome.map(String),
      });
      if (result === null) {
        return false;
      }
      await store.fetchItems();
      return true;
    }

    // Skill 接口是全量替换，只把「本次新增的标签」并进各 Skill 现有标签，避免抹掉原有标签
    const knownTagIDs = new Set<number>([...selectedTagsAll, ...selectedTagsSome]);
    const addedTagIDs = [...newSelectedTagsAll, ...newSelectedTagsSome].filter((tagID) => !knownTagIDs.has(tagID));

    // 各 Skill 现有标签不同，合并结果也就不同：按合并结果分组，尽量少发请求
    const groups = new Map<string, { ids: number[]; tags: number[] }>();
    let hasTagChange = false;

    for (const row of selectedRows) {
      const existingTagIDs = tagIDsOf(row.original);
      const mergedTags = Array.from(new Set([...existingTagIDs, ...addedTagIDs])).sort((a, b) => a - b);
      const groupKey = mergedTags.join(',');
      const group = groups.get(groupKey) ?? { ids: [], tags: mergedTags };
      group.ids.push(row.original.id);
      groups.set(groupKey, group);

      // 合并集是现有标签的超集，长度不变即本次提交不会改动任何 Skill 的标签
      hasTagChange = hasTagChange || mergedTags.length !== existingTagIDs.length;
    }

    if (!hasTagChange) {
      toast('标签无变化', { position: 'top-center' });
      return true;
    }

    let isUpdated = true;
    for (const group of groups.values()) {
      isUpdated = (await store.updateSkillTags(group.ids, group.tags)) && isUpdated;
    }

    return isUpdated;
  };

  if (selectedRowsCount === 0) {
    return null;
  }

  // 水平中心取自内容区实测几何（移动端退回视口居中），left 单位由 React 补 px
  const pageRowsCount = table.getPaginationRowModel().rows.length;
  const isAllPageRowsSelected = pageRowsCount > 0 && table.getIsAllPageRowsSelected();
  const isSomePageRowsSelected = table.getIsSomePageRowsSelected();
  // 拿到内容区节点但还没测出中心时先隐藏，避免先在视口中心闪一下再跳到正确位置
  const isPositioned = isMobile || centerX !== null || contentElement === undefined;

  return (
    <div
      role="toolbar"
      aria-label="批量操作"
      style={{
        left: isMobile || centerX === null ? '50%' : centerX,
        transform: 'translateX(-50%)',
        visibility: isPositioned ? undefined : 'hidden',
      }}
      className="bg-primary text-primary-foreground fixed bottom-[5dvh] z-50 flex items-center gap-0.5 rounded-lg p-1 shadow-lg"
    >
      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:bg-primary-foreground/16 hover:text-primary-foreground gap-1.5"
        aria-label={isAllPageRowsSelected ? '取消全选当前页' : '全选当前页'}
        title="全选/取消全选"
        onClick={() => table.toggleAllPageRowsSelected(!isAllPageRowsSelected)}
      >
        {isSomePageRowsSelected ? <SquareMinus /> : isAllPageRowsSelected ? <SquareCheckBig /> : <Square />}
        <Separator className="bg-primary-foreground/40 h-4" orientation="vertical" />
        <span className="whitespace-nowrap">{selectedRowsCount} 已选择</span>
      </Button>

      <TagSelect selectedTagsAll={selectedTagsAll} selectedTagsSome={selectedTagsSome} onSubmit={updateTagsSelected}>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-foreground hover:bg-primary-foreground/16 hover:text-primary-foreground gap-1.5"
          aria-label="批量打标签"
          title="批量打标签"
        >
          <TagsIcon />
          <span className="hidden md:inline">标签</span>
        </Button>
      </TagSelect>

      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:bg-primary-foreground/16 hover:text-primary-foreground gap-1.5"
        aria-label="刷新"
        title="刷新"
        disabled={fetchInProgress}
        onClick={refetchSelected}
      >
        {fetchInProgress ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
        <span className="hidden md:inline">刷新</span>
      </Button>

      <DeleteDialog onConfirm={deleteSelected} itemsCount={selectedRowsCount} noun={moduleConfig.noun}>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-foreground hover:bg-primary-foreground/16 hover:text-primary-foreground gap-1.5"
          aria-label={`删除所选 ${moduleConfig.noun}`}
          title="删除所选"
          disabled={deleteInProgress}
        >
          {deleteInProgress ? <Spinner /> : <Trash />}
          <span className="hidden md:inline">删除</span>
        </Button>
      </DeleteDialog>

      <Button
        variant="ghost"
        size="icon"
        className="text-primary-foreground hover:bg-primary-foreground/16 hover:text-primary-foreground size-8"
        aria-label="取消选择"
        title="取消选择"
        onClick={() => table.resetRowSelection()}
      >
        <X />
      </Button>
    </div>
  );
});
