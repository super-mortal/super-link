import type { ColumnDef } from '@tanstack/react-table';
import type { ModuleItemType } from '@/lib/modules.ts';
import { TableLayout } from '@/components/Table/Layouts/TableLayout.tsx';
import type { ModuleTableLayoutProps } from '@/components/Table/Layouts/layoutTypes.ts';
import {
  AccountAuthorizationsCell,
  AccountIdentifierCell,
  AccountNotesCell,
  AccountPasswordCell,
  AccountPlatformCell,
  AccountTotpCell,
} from '@/components/Account/AccountFieldCells.tsx';

/**
 * 账号库表格的字段列定义（PRD §9.4：表格仍按列展示）。
 *
 * key 与 `ACCOUNTS_MODULE.fields` 一一对应，由 `moduleColumns` 的
 * `buildModuleColumns('accounts')` 装配进列集合；`platform` / `identifier` 是
 * 真实 accessor 列，`password` / `totp` / `authorizations` / `notes` 是展示列
 * （数据在 secrets 里或不随列表返回，不参与取值）。
 */
export const ACCOUNT_FIELD_COLUMNS: Record<string, ColumnDef<ModuleItemType>> = {
  platform: {
    accessorKey: 'platform',
    enableSorting: true,
    enableHiding: true,
    meta: { class: 'min-w-[120px]' },
    cell: ({ row }) => <AccountPlatformCell row={row} />,
  },
  identifier: {
    accessorKey: 'identifier',
    enableSorting: true,
    enableHiding: true,
    meta: { class: 'min-w-[200px]' },
    cell: ({ row }) => <AccountIdentifierCell row={row} />,
  },
  password: {
    id: 'password',
    enableSorting: false,
    enableHiding: true,
    meta: { class: 'min-w-[170px]' },
    cell: ({ row }) => <AccountPasswordCell row={row} />,
  },
  totp: {
    id: 'totp',
    enableSorting: false,
    enableHiding: true,
    meta: { class: 'min-w-[130px]' },
    cell: ({ row }) => <AccountTotpCell row={row} />,
  },
  authorizations: {
    id: 'authorizations',
    enableSorting: false,
    enableHiding: true,
    meta: { class: 'min-w-[90px]' },
    cell: () => <AccountAuthorizationsCell />,
  },
  notes: {
    id: 'notes',
    enableSorting: false,
    enableHiding: true,
    meta: { class: 'min-w-[90px]' },
    cell: () => <AccountNotesCell />,
  },
};

/**
 * 账号库表格布局：列集合 = 固定列（多选 / 账号 / 操作）+ 账号字段列 + 隐藏的
 * `updated_at` 排序数据通道，装配在 `moduleColumns`；这里只负责渲染，
 * 列宽与横向滚动、操作列 sticky 沿用共享 `TableLayout` 的 min-w 策略（PRD §9.4）。
 */
export const AccountTable = ({ table, rows, module, visibleFields }: ModuleTableLayoutProps) => (
  <TableLayout table={table} rows={rows} module={module} visibleFields={visibleFields} />
);
