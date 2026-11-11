import type { Table } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '../../ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.tsx';
import * as React from 'react';

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  /** 「共 N 条{countNoun}」的模块量词，由 MODULES[module].pagination.count 注入 */
  countNoun?: string;
  /** 「每页{sizeNoun}数」的模块量词，由 MODULES[module].pagination.size 注入 */
  sizeNoun?: string;
  /** 列表内容区的内部滚动容器：翻页后回顶（window 不是滚动容器） */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export function Pagination<TData>({
  table,
  countNoun = '项目',
  sizeNoun = '项目',
  scrollContainerRef,
}: DataTablePaginationProps<TData>) {
  const pageIndex = table.getState().pagination.pageIndex;
  const isInitialRender = React.useRef(true);

  // 只在页码变化时回顶；挂载那次不回顶，避免刷新页面时把用户正在看的位置拉走
  React.useLayoutEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    scrollContainerRef?.current?.scrollTo({ top: 0 });
  }, [pageIndex, scrollContainerRef]);

  const rowCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="text-muted-foreground flex-1/5 text-center text-sm">
        共 {rowCount} 条{countNoun}
      </div>
      <div className="flex flex-col items-center justify-between gap-4 @lg/main:flex-row">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">每页{sizeNoun}数</div>
          <Select
            value={table.getState().pagination.pageSize.toString()}
            onValueChange={(value) => {
              // 切换每页条数必须回到第 1 页（PRD O-11）：TanStack 的 setPageSize 只保持当前
              // 首行位置，缩小每页条数时会停在换算后的中间页。一次 setPagination 同时改
              // pageSize 与 pageIndex，onPaginationChange 只触发一次，
              // 避免 setUrlState 连写两次产生多余历史记录（page=1 与 per-page 同步，刷新不丢）
              table.setPagination((old) => ({ ...old, pageIndex: 0, pageSize: Number(value) }));
            }}
          >
            {/* 固定最小宽度 + 等宽数字：9 / 96 切换时按钮宽度不跳动（对齐原型 pag-size-btn） */}
            <SelectTrigger className="min-w-19 tabular-nums">
              <SelectValue />
            </SelectTrigger>
            {/* 菜单向上展开（分页位于页面底部）；Radix Portal 渲染，不会被内容区裁剪 */}
            <SelectContent side="top" className="min-w-24">
              {/* 每页条数选项三模块共用（PRD §9.4）：3 的倍数，默认 24；当前项常驻高亮加粗，
                  勾选标记由 SelectItem 的 ItemIndicator 渲染 */}
              {[9, 24, 48, 96].map((pageSize) => (
                <SelectItem
                  key={pageSize}
                  value={`${pageSize}`}
                  className="data-[state=checked]:bg-accent data-[state=checked]:font-medium"
                >
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">
            第 {pageIndex + 1} 页，共 {table.getPageCount()} 页
          </div>
          <Button
            variant="outline"
            className="@lg:flex"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">跳转到第一页</span>
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            className=""
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">上一页</span>
            <ChevronLeft />
          </Button>
          <Button variant="outline" className="" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <span className="sr-only">下一页</span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            className="lg:flex"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">跳转到最后一页</span>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
