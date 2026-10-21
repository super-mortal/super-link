'use client';

import * as React from 'react';
import { startTransition, useContext, useEffect, useMemo, useState } from 'react';
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { StoreContext } from '@/store/storeContext.ts';
import { Search } from '../components/Table/Controls/Search.tsx';
import { observer } from 'mobx-react-lite';
import { Sorter } from '../components/Table/Controls/Sorter.tsx';
import { Pagination } from '../components/Table/Controls/Pagination.tsx';
import { CardsLayout } from '../components/Table/Layouts/CardsLayout.tsx';
import { LayoutType, ModuleKey, TagFilterType, TagsObjectType } from '@/lib/types.ts';
import { ModuleCardActions } from '@/components/Table/Fields/ModuleCardActions.tsx';
import { SourceBadge, UpdateBadge } from '@/components/Table/Fields/SourceBadge.tsx';
import { isSkillItem, tagIDsOf } from '@/components/Table/Fields/moduleItem.ts';
import Loading from '@/layouts/Loading.tsx';
import {
  cn,
  getSavedLayoutColumnVisibilityPreference,
  getSavedLayoutPreference,
  saveLayoutColumnVisibilityPreference,
  saveLayoutPreference,
} from '@/lib/utils.ts';
import { TableLayout } from '@/components/Table/Layouts/TableLayout.tsx';
import { FieldToggler } from '@/components/Table/Controls/FieldToggler.tsx';
import { TagBadge } from '@/components/Table/Fields/TagBadge.tsx';
import { ListLayout } from '@/components/Table/Layouts/ListLayout.tsx';
import { LayoutSelector } from '@/components/Table/Controls/LayoutSelector.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Button } from '@/components/ui/button.tsx';
import { PackagePlus, PlusIcon, Settings2, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { BulkActionControls } from '@/components/Table/Controls/BulkActionControls.tsx';
import { useUrlState } from '@/hooks/useUrlState.ts';
import { useItemListState } from '@/hooks/useItemListState.ts';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { MODULES, type ModuleItemType } from '@/lib/modules.ts';
import { InstallSkillDialog } from '@/components/InstallSkillDialog.tsx';

/** 全局搜索的匹配文本：标题 / 链接或来源 / 描述 / 标签名（模块差异集中在这里） */
const buildSearchText = (item: ModuleItemType, tags: TagsObjectType): string => {
  const tagTitles = tagIDsOf(item)
    .map((tagID) => tags[tagID]?.title ?? '')
    .join(' ');
  const ownFields = isSkillItem(item)
    ? [item.name, item.source_url, item.description]
    : [item.title, item.url, item.description];

  return [...ownFields, tagTitles]
    .filter((value) => Boolean(value))
    .join(' ')
    .toLowerCase();
};

const selectColumn: ColumnDef<ModuleItemType> = {
  id: 'select',
  header: ({ table }) => (
    <Checkbox
      checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() ? 'indeterminate' : false)}
      onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      aria-label="全选"
      className={cn(
        'onhover-visible bg-primary-foreground',
        table.getIsAllPageRowsSelected() || table.getIsSomePageRowsSelected() ? 'opacity-100!' : ''
      )}
    />
  ),
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
      aria-label="选择行"
      className={cn(
        'onhover-visible bg-primary-foreground dark:bg-primary-foreground',
        row.getIsSelected() ? 'opacity-100!' : ''
      )}
    />
  ),
  enableSorting: false,
  enableHiding: false,
  meta: { isAction: true },
};

const tagsColumn: ColumnDef<ModuleItemType> = {
  accessorKey: 'tags',
  enableSorting: false,
  enableHiding: true,
  meta: { class: 'min-w-xs' },

  filterFn: (row, columnId, filterValue: number[] | 'none' | null) => {
    if (filterValue === null) {
      return true;
    }
    const tagIDs = tagIDsOf(row.original);
    if (filterValue === 'none') {
      return tagIDs.length === 0;
    }
    return tagIDs.some((val) => filterValue.includes(val));
  },
  cell: ({ row }) => {
    const tagIDs = tagIDsOf(row.original);
    if (tagIDs.length === 0) {
      return null;
    }
    return (
      <div className="flex w-full flex-wrap gap-1 py-2 leading-6.5">
        {tagIDs.map((tagID) => (
          <TagBadge key={tagID} tagID={tagID} />
        ))}
      </div>
    );
  },
};

/** 标题列是固定列（不在 fields 内），accessorKey 与模块排序键一致 */
const TITLE_ACCESSOR_KEY: Record<ModuleKey, 'title' | 'name'> = {
  bookmarks: 'title',
  skills: 'name',
};

/** 可勾选字段的单元格定义：键与 MODULES[module].fields 的 key 一一对应 */
const FIELD_COLUMN_DEFS: Record<string, ColumnDef<ModuleItemType>> = {
  url: {
    accessorKey: 'url',
    enableSorting: true,
    enableHiding: true,
    meta: { class: 'min-w-xs break-all' },
    cell: ({ row }) => {
      const value = row.getValue('url') as string;
      return (
        <a className="underline" href={value} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      );
    },
  },
  tags: tagsColumn,
  description: {
    accessorKey: 'description',
    enableSorting: true,
    enableHiding: true,
    meta: { class: 'min-w-xs' },
  },
  created_at: {
    accessorKey: 'created_at',
    enableSorting: true,
    enableHiding: true,
    meta: { class: 'min-w-[170px]' },
  },
  installed_at: {
    accessorKey: 'installed_at',
    enableSorting: true,
    enableHiding: true,
    meta: { class: 'min-w-[170px]' },
  },
  fingerprint: {
    accessorKey: 'fingerprint',
    enableSorting: true,
    enableHiding: true,
    meta: { class: 'min-w-[140px]' },
    cell: ({ row }) => {
      const value = row.getValue('fingerprint') as string;
      return (
        <code className="font-mono text-xs break-all" title={value}>
          {value}
        </code>
      );
    },
  },
};

const buildTitleColumn = (module: ModuleKey): ColumnDef<ModuleItemType> => {
  const moduleConfig = MODULES[module];

  return {
    accessorKey: TITLE_ACCESSOR_KEY[module],
    header: moduleConfig.titleLabel,
    enableSorting: true,
    // 标题是固定列，不参与字段勾选（可勾选清单只来自 MODULES.fields）
    enableHiding: false,
    meta: { class: 'min-w-xs' },
    cell: ({ row }) => {
      const item = row.original;
      const skill = isSkillItem(item);

      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium" title={moduleConfig.titleOf(item)}>
            {moduleConfig.titleOf(item)}
          </span>
          {skill && <SourceBadge sourceType={item.source_type} />}
          {skill && item.hasUpdate && <UpdateBadge />}
        </div>
      );
    },
  };
};

const buildActionsColumn = (module: ModuleKey): ColumnDef<ModuleItemType> => ({
  id: 'actions',
  cell: ({ row }) => <ModuleCardActions module={module} item={row.original} />,
  enableSorting: false,
  enableHiding: false,
  meta: { isAction: true, isPinned: true },
});

/**
 * 排序数据通道：updated_at 不在 MODULES.fields 里（不可勾选、表格不渲染），
 * 但排序项「更新时间（新→旧）」要求 sorting.id='updated_at' 能命中一个可排序列，
 * 所以保留列定义并默认隐藏，而不是用假排序绕过。
 */
const updatedAtSortColumn: ColumnDef<ModuleItemType> = {
  accessorKey: 'updated_at',
  header: '更新时间',
  enableSorting: true,
  enableHiding: true,
  meta: { class: 'min-w-[170px]' },
};

/** 列集合 = 固定列（多选 / 标题 / 操作）+ MODULES.fields + 隐藏的排序数据通道 */
const buildModuleColumns = (module: ModuleKey): ColumnDef<ModuleItemType>[] => [
  selectColumn,
  buildTitleColumn(module),
  ...MODULES[module].fields.map((field) => ({ ...FIELD_COLUMN_DEFS[field.key], header: field.label })),
  updatedAtSortColumn,
  buildActionsColumn(module),
];

const buildColumnOrder = (module: ModuleKey): string[] => [
  'select',
  TITLE_ACCESSOR_KEY[module],
  ...MODULES[module].fields.map((field) => field.key),
  'updated_at',
  'actions',
];

const MODULE_COLUMNS: Record<ModuleKey, ColumnDef<ModuleItemType>[]> = {
  bookmarks: buildModuleColumns('bookmarks'),
  skills: buildModuleColumns('skills'),
};

const MODULE_COLUMN_ORDER: Record<ModuleKey, string[]> = {
  bookmarks: buildColumnOrder('bookmarks'),
  skills: buildColumnOrder('skills'),
};

const Table = observer(() => {
  const store = React.useContext(StoreContext);

  const module = store.module;
  const moduleConfig = MODULES[module];
  const sortOptions = moduleConfig.sorts;
  const defaultSortOption = sortOptions.find((option) => option.key === moduleConfig.defaultSort) ?? sortOptions[0];

  const { searchParams, setUrlState } = useUrlState();

  const { pageIndexParam, pageSizeParam, sortByParam, isSortOrderDescParam, searchKeywordParam, tagFilterParam } =
    useMemo(() => {
      const rawSortBy = searchParams.get('sort');
      const sortBy =
        rawSortBy && sortOptions.some((option) => option.sortBy === rawSortBy) ? rawSortBy : defaultSortOption.sortBy;
      const rawOrder = searchParams.get('order');
      const isDesc = rawOrder ? rawOrder === 'desc' : defaultSortOption.order === 'desc';
      const tagParam = searchParams.get('tag');

      let tagFilter: TagFilterType = null;
      if (tagParam === 'none') {
        tagFilter = tagParam;
      } else if (tagParam !== null) {
        const numValue = Number(tagParam);
        tagFilter = isNaN(numValue) ? null : numValue;
      }

      return {
        pageIndexParam: Number(searchParams.get('page') ?? 1) - 1,
        pageSizeParam: Number(searchParams.get('per-page') ?? 25),
        sortByParam: sortBy,
        isSortOrderDescParam: isDesc,
        searchKeywordParam: searchParams.get('search') ?? '',
        tagFilterParam: tagFilter,
      };
    }, [searchParams, sortOptions, defaultSortOption]);

  const [globalFilter, setGlobalFilter] = React.useState<string>(searchKeywordParam);

  const tagColumnFilter = store.itemListFilters.tags;

  const columnFilters: ColumnFiltersState = [
    {
      id: 'tags',
      value: tagColumnFilter,
    },
  ];
  const [rowSelection, setRowSelection] = React.useState({});
  const [layout, setLayout] = useState<LayoutType>(getSavedLayoutPreference());
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    getSavedLayoutColumnVisibilityPreference(module, layout)
  );
  const [pagination, setPagination] = useState({
    pageIndex: pageIndexParam,
    pageSize: pageSizeParam,
  });
  const [sorting, setSorting] = React.useState<SortingState>([
    {
      id: sortByParam,
      desc: isSortOrderDescParam,
    },
  ]);
  const [columnOrder, setColumnOrder] = useState<string[]>(MODULE_COLUMN_ORDER[module]);
  /** 内容区是内部滚动容器，翻页回顶必须作用在它身上（window 不滚动） */
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  /**
   * 同一个节点再用 callback ref 落到 state：批量操作 pill 要实测内容区几何，
   * 而祖先节点的 ref 挂载晚于后代 effect，必须由节点挂载这一事件驱动测量。
   */
  const [scrollContainerEl, setScrollContainerEl] = React.useState<HTMLDivElement | null>(null);
  const setScrollContainerNode = React.useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollContainerEl(node);
  }, []);

  /**
   * State and URL syncing
   */
  // Search >
  const setGlobalFilterFromTable = (updaterOrValue) => {
    const newGlobalFilter = typeof updaterOrValue === 'function' ? updaterOrValue(globalFilter) : updaterOrValue;
    setGlobalFilter(newGlobalFilter);
    setPagination((oldValue) => {
      return {
        pageIndex: 0,
        pageSize: oldValue.pageSize,
      };
    });
  };

  // Update state from navigation changes
  useEffect(() => {
    if (globalFilter === searchKeywordParam) {
      return;
    }
    setGlobalFilter(searchKeywordParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKeywordParam]);

  // Update URL from state change with delay
  useEffect(() => {
    if (globalFilter === searchKeywordParam) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setUrlState({
        search: globalFilter,
        // Preventing race conditions
        page: 1,
      });
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilter]);
  // ^ Search

  // Pagination >
  const setPaginationFromTable = (updaterOrValue) => {
    const newPagination = typeof updaterOrValue === 'function' ? updaterOrValue(pagination) : updaterOrValue;

    setPagination(newPagination);
    setUrlState({
      page: newPagination.pageIndex + 1,
      'per-page': newPagination.pageSize,
    });
  };

  // Update state from navigation changes
  useEffect(() => {
    if (pagination.pageIndex === pageIndexParam && pagination.pageSize === pageSizeParam) {
      return;
    }

    setPagination({
      pageIndex: pageIndexParam,
      pageSize: pageSizeParam,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndexParam, pageSizeParam]);
  // ^ Pagination

  // Sorting >
  const applySorting = (columnId: string, isDesc: boolean) => {
    setSorting([
      {
        id: columnId,
        desc: isDesc,
      },
    ]);
    setPagination((oldValue) => {
      return {
        pageIndex: 0,
        pageSize: oldValue.pageSize,
      };
    });
  };

  // Update state from navigation changes
  useEffect(() => {
    if (sorting[0]?.id === sortByParam && sorting[0]?.desc === isSortOrderDescParam) {
      return;
    }

    applySorting(sortByParam, isSortOrderDescParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortByParam, isSortOrderDescParam]);
  // ^ Sorting

  // Tag >
  const { setTagFilter } = useItemListState();
  // Update state from navigation changes
  useEffect(() => {
    if (store.tagFilter === tagFilterParam) {
      return;
    }

    setTagFilter(tagFilterParam, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilterParam]);
  // ^ Tag
  /**
   * End of state and URL syncing
   */

  useEffect(() => {
    setColumnVisibility(getSavedLayoutColumnVisibilityPreference(module, layout));
  }, [module, layout]);

  const globalFilterFn = React.useCallback<FilterFn<ModuleItemType>>(
    (row, _columnId, filterValue) => {
      const keyword = String(filterValue ?? '')
        .trim()
        .toLowerCase();
      if (!keyword) {
        return true;
      }
      return buildSearchText(row.original, store.tags).includes(keyword);
    },
    [store.tags]
  );

  const data: ModuleItemType[] = module === 'skills' ? store.skills : store.items;

  const table = useReactTable({
    data,
    columns: MODULE_COLUMNS[module],
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilterFromTable,
    onColumnOrderChange: setColumnOrder,
    onPaginationChange: setPaginationFromTable,
    globalFilterFn,
    autoResetPageIndex: false,
    state: {
      sorting,
      columnFilters,
      columnOrder,
      columnVisibility,
      rowSelection,
      globalFilter,
      pagination,
    },
  });
  const currentRows = table.getPaginationRowModel().rows;
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const fieldColumns = useMemo(
    () =>
      moduleConfig.fields
        .map((field) => table.getColumn(field.key))
        .filter((column): column is Column<ModuleItemType, unknown> => Boolean(column?.getCanHide())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moduleConfig.fields, table, module]
  );
  // 可见字段（key 与 MODULES.fields 一致）下发给三布局：卡片 / 列表据此门控区块，表格据此过滤列
  const visibleFields = useMemo(
    () => moduleConfig.fields.filter((field) => columnVisibility[field.key] !== false).map((field) => field.key),
    [moduleConfig.fields, columnVisibility]
  );

  // Reset row selection on table state changes（批量操作条随之消失）
  useEffect(() => {
    startTransition(() => {
      table.resetRowSelection();
    });
  }, [globalFilter, sorting, pagination, store.tagFilter, table]);

  useEffect(() => {
    if (table.getState().pagination.pageIndex >= table.getPageCount()) {
      table.lastPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getPageCount()]);

  // 模块切换：分页回第 1 页、清空搜索与排序参数、重置列顺序（不写回 URL 的默认排序）
  const previousModule = React.useRef(module);
  useEffect(() => {
    if (previousModule.current === module) {
      return;
    }
    previousModule.current = module;

    setColumnOrder(MODULE_COLUMN_ORDER[module]);
    setGlobalFilter('');
    setRowSelection({});
    applySorting(defaultSortOption.sortBy, defaultSortOption.order === 'desc');
    setPagination((oldValue) => ({ pageIndex: 0, pageSize: oldValue.pageSize }));
    setUrlState({ page: null, search: null, sort: null, order: null, tag: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  const updateSorting = (sortKey: string) => {
    const option = sortOptions.find((item) => item.key === sortKey) ?? defaultSortOption;

    applySorting(option.sortBy, option.order === 'desc');
    setUrlState({
      sort: option.sortBy,
      order: option.order,
      page: 1,
    });
  };

  const selectedSortKey =
    sortOptions.find(
      (option) => option.sortBy === sorting[0]?.id && option.order === (sorting[0]?.desc ? 'desc' : 'asc')
    )?.key ?? defaultSortOption.key;

  const updateLayout = (newValue: LayoutType) => {
    setLayout(newValue);
    saveLayoutPreference(newValue);
  };

  const updateColumnVisibility = (columnId: string, isVisible: boolean) => {
    const newVisibility = {
      ...table.getState().columnVisibility,
      [columnId]: isVisible,
    };
    const remainingVisibleColumns = fieldColumns.filter((column) => newVisibility[column.id] !== false);

    if (remainingVisibleColumns.length === 0) {
      toast.error('最后一个可见字段不能被隐藏', {
        position: 'top-center',
      });
      return;
    }
    setColumnVisibility(newVisibility);
    saveLayoutColumnVisibilityPreference(module, layout, newVisibility);
  };

  const handleAdd = () => {
    if (module === 'skills') {
      store.openInstallSkillDialog();
      return;
    }

    store.openItemCreateModal();
  };

  const layouts: Record<LayoutType, React.ReactNode> = {
    list: <ListLayout rows={currentRows} module={module} visibleFields={visibleFields} />,
    cards: <CardsLayout rows={currentRows} module={module} visibleFields={visibleFields} />,
    table: <TableLayout table={table} rows={currentRows} module={module} visibleFields={visibleFields} />,
  };

  // 标签筛选横幅只对具体标签显示；'none'（未标记）不显示
  const activeTag = typeof store.tagFilter === 'number' ? store.tags[store.tagFilter] : undefined;
  const activeTagLabel = activeTag ? activeTag.fullPath.replaceAll('\\/', '/') : String(store.tagFilter);

  const emptyText =
    store.tagFilter === 'none'
      ? `没有未标记的${moduleConfig.noun}。`
      : typeof store.tagFilter === 'number'
        ? `该标签下暂无${moduleConfig.noun}。`
        : `暂无${moduleConfig.noun}。`;

  return (
    <div className="flex h-full flex-col">
      <header className="bg-background sticky top-0 z-50 flex h-14 w-full items-center gap-1.5 border-b px-4 backdrop-blur-sm group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
        <SidebarToggler />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Settings2 className="h-4 w-4" />
              <span className="hidden @xl/main:inline-block">视图</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40">
            <DropdownMenuLabel>布局</DropdownMenuLabel>
            <div className="mx-1 mb-3">
              <LayoutSelector layout={layout} onChange={updateLayout} />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>可见字段</DropdownMenuLabel>
            <FieldToggler columns={fieldColumns} onChange={updateColumnVisibility} />
          </DropdownMenuContent>
        </DropdownMenu>
        <Search table={table} globalFilter={globalFilter} className="flex-1" />
        <Sorter sorts={sortOptions} selectedSort={selectedSortKey} onChange={updateSorting} />
        <Button variant="default" onClick={handleAdd}>
          {module === 'skills' ? <PackagePlus /> : <PlusIcon />}
          <span className="hidden @xl/main:inline-block">{moduleConfig.addLabel}</span>
        </Button>
      </header>

      <div ref={setScrollContainerNode} className="h-full overflow-x-clip overflow-y-scroll">
        {typeof store.tagFilter === 'number' && (
          <div className="bg-muted text-muted-foreground mx-4 mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-xs">
            <Tag className="h-3 w-3 shrink-0" />
            <span className="truncate">
              按标签筛选：<b className="text-foreground font-medium">{activeTagLabel}</b>
            </span>
            <button
              type="button"
              className="hover:text-foreground ml-auto flex shrink-0 items-center gap-1"
              onClick={() => setTagFilter(null)}
            >
              <X className="h-3 w-3" />
              清除
            </button>
          </div>
        )}
        {filteredRowCount > 0 ? (
          <div className={`flex h-full flex-col justify-between gap-5 module-list--${layout}`}>
            {layouts[layout]}
            <Pagination
              table={table}
              countNoun={moduleConfig.pagination.count}
              sizeNoun={moduleConfig.pagination.size}
              scrollContainerRef={scrollContainerRef}
            />
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-lg">{emptyText}</div>
        )}
        <BulkActionControls table={table} rowSelection={rowSelection} contentElement={scrollContainerEl} />
      </div>
    </div>
  );
});

// 需要 observer：store.module 变化时要触发按模块懒加载
export const ModuleList = observer(() => {
  const store = useContext(StoreContext);

  const [isLoading, setIsLoading] = useState(true);
  const loadedModules = React.useRef<Set<ModuleKey>>(new Set());
  const isTagsLoaded = React.useRef(false);

  useEffect(() => {
    const loadData = async () => {
      const requests: Promise<unknown>[] = [];

      if (!isTagsLoaded.current) {
        isTagsLoaded.current = true;
        requests.push(store.fetchTags());
      }
      // 两个模块按需加载，切换回来时复用已拉取的数据
      if (!loadedModules.current.has(store.module)) {
        loadedModules.current.add(store.module);
        requests.push(store.module === 'skills' ? store.fetchSkills() : store.fetchItems());
      }

      await Promise.all(requests);
      setIsLoading(false);
    };

    loadData();
  }, [store, store.module]);

  if (isLoading) {
    return <Loading />;
  }

  return (
    <Dashboard>
      <Table />
      <InstallSkillDialog />
    </Dashboard>
  );
});
