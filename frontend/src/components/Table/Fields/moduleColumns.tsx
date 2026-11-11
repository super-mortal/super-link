import type { ColumnDef } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { cn } from '@/lib/utils.ts';
import { MODULES } from '@/lib/modules.ts';
import type { ModuleItemType } from '@/lib/modules.ts';
import type { ModuleKey } from '@/lib/types.ts';
import { TagBadge } from '@/components/Table/Fields/TagBadge.tsx';
import { SourceBadge, UpdateBadge } from '@/components/Table/Fields/SourceBadge.tsx';
import { ModuleCardActions } from '@/components/Table/Fields/ModuleCardActions.tsx';
import { isSkillItem, tagIDsOf } from '@/components/Table/Fields/moduleItem.ts';
import { ACCOUNT_FIELD_COLUMNS } from '@/components/Account/Layouts/AccountTable.tsx';

/**
 * 三模块共用的 react-table 列集合（书签 / Skill 列表页与账号库列表外壳都从这里取）。
 *
 * 模块差异全部来自 `MODULES[module].fields` 与下方的字段列字典，组件里不再写
 * 模块 if-else；账号库的字段列定义在 `Account/Layouts/AccountTable.tsx`，
 * 按 key 合并进来，保持「一个字段 key 一套列定义」。
 */
export const selectColumn: ColumnDef<ModuleItemType> = {
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
  accounts: 'name',
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
  // 账号库字段列（平台 / 账号标识 / 密码 / 2FA / 授权 / 备注）
  ...ACCOUNT_FIELD_COLUMNS,
};

export const buildTitleColumn = (module: ModuleKey): ColumnDef<ModuleItemType> => {
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

export const buildActionsColumn = (module: ModuleKey): ColumnDef<ModuleItemType> => ({
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

export const MODULE_COLUMNS: Record<ModuleKey, ColumnDef<ModuleItemType>[]> = {
  bookmarks: buildModuleColumns('bookmarks'),
  skills: buildModuleColumns('skills'),
  accounts: buildModuleColumns('accounts'),
};

export const MODULE_COLUMN_ORDER: Record<ModuleKey, string[]> = {
  bookmarks: buildColumnOrder('bookmarks'),
  skills: buildColumnOrder('skills'),
  accounts: buildColumnOrder('accounts'),
};
