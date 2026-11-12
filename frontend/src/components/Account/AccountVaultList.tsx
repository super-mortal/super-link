'use client';

import * as React from 'react';
import { startTransition, useEffect, useMemo, useState } from 'react';
import type { Column, SortingState, VisibilityState } from '@tanstack/react-table';
import { getCoreRowModel, getPaginationRowModel, useReactTable } from '@tanstack/react-table';
import { observer } from 'mobx-react-lite';
import { Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { StoreContext } from '@/store/storeContext.ts';
import { Search } from '@/components/Table/Controls/Search.tsx';
import { Sorter } from '@/components/Table/Controls/Sorter.tsx';
import { Pagination } from '@/components/Table/Controls/Pagination.tsx';
import { LayoutSelector } from '@/components/Table/Controls/LayoutSelector.tsx';
import { FieldToggler } from '@/components/Table/Controls/FieldToggler.tsx';
import { BulkActionControls } from '@/components/Table/Controls/BulkActionControls.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Button } from '@/components/ui/button.tsx';
import { VaultToolbar } from '@/components/Account/VaultToolbar.tsx';
import { AccountEmptyState } from '@/components/Account/AccountEmptyState.tsx';
import { AccountGroupFilter } from '@/components/Account/AccountGroupFilter.tsx';
import { AccountList } from '@/components/Account/Layouts/AccountList.tsx';
import { AccountCards } from '@/components/Account/Layouts/AccountCards.tsx';
import { AccountTable } from '@/components/Account/Layouts/AccountTable.tsx';
import {
  AccountDialog,
  AccountDialogContext,
  type AccountDialogControllerType,
} from '@/components/Account/AccountDialog.tsx';
import { MODULE_COLUMNS, MODULE_COLUMN_ORDER } from '@/components/Table/Fields/moduleColumns.tsx';
import { MODULES, type ModuleItemType } from '@/lib/modules.ts';
import { LayoutType } from '@/lib/types.ts';
import {
  getSavedLayoutColumnVisibilityPreference,
  getSavedLayoutPreference,
  saveLayoutColumnVisibilityPreference,
  saveLayoutPreference,
} from '@/lib/utils.ts';
import { useUrlState } from '@/hooks/useUrlState.ts';
import { useAccountListState } from '@/hooks/useAccountListState.ts';
import Loading from '@/layouts/Loading.tsx';

/**
 * 账号库列表外壳（PRD §9.3 / §9.4）。
 *
 * 与书签 / Skill 的 `ModuleList` 共用同一套外壳控件（视图 / 搜索 / 排序 / 分页 /
 * 批量操作条）与列集合，差异只在数据来源与查询方式：
 * - 账号数据走 `mainStore.accounts`，搜索 / 平台 / 分组 / 排序由服务端处理
 *   （密文字段服务端不可搜，PRD §9.5），筛选条件变化即重新 `fetchAccounts`；
 * - 分页仍在前端做：不传 page / per-page，后端返回全量过滤结果（与 Skill 列表一致）；
 * - 排序态只是 URL 的镜像——服务端已排序，这里不挂 `getSortedRowModel`，
 *   避免同一列被二次排序（`password_updated_at` 排序甚至没有对应列）；
 * - 锁定态不渲染本组件（页面只在校验解锁后挂载），因此这里不出现任何解密逻辑。
 */
export const AccountVaultList = observer(() => {
  const store = React.useContext(StoreContext);
  const moduleConfig = MODULES.accounts;
  const sortOptions = moduleConfig.sorts;
  const defaultSortOption = sortOptions.find((option) => option.key === moduleConfig.defaultSort) ?? sortOptions[0];

  const { searchParams, setUrlState } = useUrlState();
  const { platform, group, setPlatformFilter } = useAccountListState();

  // URL 是筛选条件的唯一来源（与 ModuleList 同构）
  const { pageIndexParam, pageSizeParam, sortByParam, isSortOrderDescParam, searchKeywordParam } = useMemo(() => {
    const rawSortBy = searchParams.get('sort');
    const sortBy =
      rawSortBy && sortOptions.some((option) => option.sortBy === rawSortBy) ? rawSortBy : defaultSortOption.sortBy;
    const rawOrder = searchParams.get('order');
    const isDesc = rawOrder ? rawOrder === 'desc' : defaultSortOption.order === 'desc';

    return {
      pageIndexParam: Number(searchParams.get('page') ?? 1) - 1,
      // 默认每页 24 条，与分页下拉选项 9 / 24 / 48 / 96 一致（PRD §9.4，三模块共用）
      pageSizeParam: Number(searchParams.get('per-page') ?? 24),
      sortByParam: sortBy,
      isSortOrderDescParam: isDesc,
      searchKeywordParam: searchParams.get('search') ?? '',
    };
  }, [searchParams, sortOptions, defaultSortOption]);

  const [globalFilter, setGlobalFilter] = React.useState<string>(searchKeywordParam);
  const [layout, setLayout] = useState<LayoutType>(getSavedLayoutPreference());
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    getSavedLayoutColumnVisibilityPreference('accounts', layout)
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
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnOrder, setColumnOrder] = useState<string[]>(MODULE_COLUMN_ORDER.accounts);
  /** 首次拉取完成前的加载态：与 ModuleList 一致，避免空列表闪烁 */
  const [initialLoaded, setInitialLoaded] = useState(false);
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

  /** 账号弹窗状态：新建 / 编辑（按账号 id）二选一，null = 关闭 */
  const [accountDialog, setAccountDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number } | null>(null);
  /**
   * 弹窗控制器经 context 下发：工具栏、空态与三种布局的操作菜单（ModuleCardActions）
   * 共用同一组打开入口，不必把回调透传进共享的 moduleColumns / 布局组件。
   */
  const accountDialogController = useMemo<AccountDialogControllerType>(
    () => ({
      openCreate: () => setAccountDialog({ mode: 'create' }),
      openEdit: (id: number) => setAccountDialog({ mode: 'edit', id }),
    }),
    []
  );

  /**
   * State and URL syncing
   */
  // Search >
  const setGlobalFilterFromTable = (updaterOrValue: string | ((prev: string) => string)) => {
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
  /**
   * End of state and URL syncing
   */

  // 服务端查询：筛选 / 排序 / 搜索变化即重新拉取（分页参数不传，后端全量返回）
  useEffect(() => {
    const load = async () => {
      await store.fetchAccounts({
        search: searchKeywordParam,
        platform,
        group,
        sort: sortByParam,
        order: isSortOrderDescParam ? 'desc' : 'asc',
      });
      setInitialLoaded(true);
    };

    void load();
  }, [store, searchKeywordParam, platform, group, sortByParam, isSortOrderDescParam]);

  // 布局切换时按对应 key 读取字段可见性：column-visibility-accounts-<layout>
  useEffect(() => {
    setColumnVisibility(getSavedLayoutColumnVisibilityPreference('accounts', layout));
  }, [layout]);

  const data: ModuleItemType[] = store.accounts;

  const table = useReactTable({
    data,
    columns: MODULE_COLUMNS.accounts,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilterFromTable,
    onColumnOrderChange: setColumnOrder,
    onPaginationChange: setPaginationFromTable,
    autoResetPageIndex: false,
    state: {
      sorting,
      columnOrder,
      columnVisibility,
      rowSelection,
      pagination,
    },
  });
  const currentRows = table.getPaginationRowModel().rows;
  const fieldColumns = useMemo(
    () =>
      moduleConfig.fields
        .map((field) => table.getColumn(field.key))
        .filter((column): column is Column<ModuleItemType, unknown> => Boolean(column?.getCanHide())),
    [moduleConfig.fields, table]
  );
  // 可见字段（key 与 MODULES.fields 一致）下发给三布局：列表 / 卡片据此门控区块，表格据此过滤列
  const visibleFields = useMemo(
    () => moduleConfig.fields.filter((field) => columnVisibility[field.key] !== false).map((field) => field.key),
    [moduleConfig.fields, columnVisibility]
  );

  // Reset row selection on table state changes（批量操作条随之消失）；
  // 筛选条件变化会整体换数据，旧勾选必须一起清掉，否则批量条会指向已不在结果集里的账号
  useEffect(() => {
    startTransition(() => {
      table.resetRowSelection();
    });
  }, [globalFilter, sorting, pagination, searchKeywordParam, platform, group, table]);

  useEffect(() => {
    if (table.getState().pagination.pageIndex >= table.getPageCount()) {
      table.lastPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getPageCount()]);

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
    saveLayoutColumnVisibilityPreference('accounts', layout, newVisibility);
  };

  const layouts: Record<LayoutType, React.ReactNode> = {
    list: <AccountList rows={currentRows} module="accounts" visibleFields={visibleFields} />,
    cards: <AccountCards rows={currentRows} module="accounts" visibleFields={visibleFields} />,
    table: <AccountTable table={table} rows={currentRows} module="accounts" visibleFields={visibleFields} />,
  };

  // 空态优先级（PRD §10.6）：搜索无结果 > 平台筛选为空 > 账号库本身为空
  const emptyVariant = searchKeywordParam ? 'search' : platform ? 'platform' : 'empty';

  if (!initialLoaded) {
    return <Loading />;
  }

  return (
    <AccountDialogContext.Provider value={accountDialogController}>
      <div className="flex h-full flex-col">
        <VaultToolbar
          onAdd={accountDialogController.openCreate}
          listControls={
            <>
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
              <Search table={table} globalFilter={globalFilter} />
              <Sorter sorts={sortOptions} selectedSort={selectedSortKey} onChange={updateSorting} />
              <AccountGroupFilter />
            </>
          }
        />

        <div ref={setScrollContainerNode} className="h-full overflow-x-clip overflow-y-scroll">
          {store.accounts.length > 0 ? (
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
            <AccountEmptyState
              variant={emptyVariant}
              onAdd={accountDialogController.openCreate}
              onClearPlatform={() => setPlatformFilter(null)}
              onClearSearch={() => setUrlState({ search: null, page: 1 })}
            />
          )}
          <BulkActionControls
            table={table}
            rowSelection={rowSelection}
            contentElement={scrollContainerEl}
            module="accounts"
          />
        </div>
      </div>

      {/* 弹窗挂在 Provider 内：三种布局的操作菜单（ModuleCardActions）经 context 打开编辑 */}
      <AccountDialog
        open={accountDialog !== null}
        onOpenChange={(next) => {
          if (!next) {
            setAccountDialog(null);
          }
        }}
        accountId={accountDialog?.mode === 'edit' ? accountDialog.id : null}
      />
    </AccountDialogContext.Provider>
  );
});
