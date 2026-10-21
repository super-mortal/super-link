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
              const newPageSize = Number(value);
              table.setPageSize(newPageSize);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {[10, 25, 50, 100].map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
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
