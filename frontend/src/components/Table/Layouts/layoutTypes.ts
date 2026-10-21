import type { Row, RowData, Table } from '@tanstack/react-table';
import type { ModuleItemType } from '@/lib/modules.ts';
import type { ModuleKey } from '@/lib/types.ts';

// 列定义里用到的自定义 meta（宽度类、操作列、固定列）
declare module '@tanstack/react-table' {
  // 与库内部签名保持一致，泛型参数必须声明
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    class?: string;
    isAction?: boolean;
    isPinned?: boolean;
  }
}

/** 三个布局统一签名：模块与可见字段由 ModuleList 注入，字段 key 与 MODULES[module].fields 一致 */
export type ModuleLayoutProps = {
  rows: Row<ModuleItemType>[];
  module: ModuleKey;
  /** 当前可见字段 key；三布局都据此门控区块（表格布局用于列过滤兜底） */
  visibleFields: readonly string[];
};

export type ModuleTableLayoutProps = ModuleLayoutProps & {
  table: Table<ModuleItemType>;
};
