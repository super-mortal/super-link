import type { ItemType, ModuleKey, SkillType } from '@/lib/types.ts';

/**
 * 模块注册表：书签 / Skill 的全部差异（标题、日期、字段、排序、路由、文案）都在这里，
 * 侧栏、工具栏、卡片、列表、表格、分页统一以 ModuleConfigType 签名消费，不再各自判断模块。
 */
export type ModuleItemType = ItemType | SkillType;

export type ModuleFieldType = {
  readonly key: string;
  readonly label: string;
};

export type ModuleSortType = {
  readonly key: string;
  readonly label: string;
  readonly sortBy: string;
  readonly order: 'asc' | 'desc';
};

export type ModuleRoutesType = {
  /** 新建页路由；模块内联新建时为 null */
  readonly create: string | null;
  /** 详情页路由构造器；无详情页时为 null */
  readonly detail: ((id: number) => string) | null;
};

export type ModuleConfigType = {
  readonly key: ModuleKey;
  /** 侧栏模块名 */
  readonly label: string;
  /** 量词用名词：空态文案使用 */
  readonly noun: string;
  /** 分页文案量词：count 用于「共 N 条{count}」，size 用于「每页{size}数」 */
  readonly pagination: { readonly count: string; readonly size: string };
  /** 侧栏标签分区名 */
  readonly sectionLabel: string;
  readonly dateLabel: string;
  /** 表格布局首列表头 */
  readonly titleLabel: string;
  readonly addLabel: string;
  readonly titleOf: (item: ModuleItemType) => string;
  readonly dateOf: (item: ModuleItemType) => string | null;
  readonly updatedOf: (item: ModuleItemType) => string | null;
  /** key 与表格列 id / 字段可见性存储 key 对齐 */
  readonly fields: readonly ModuleFieldType[];
  /** key 为前端排序态标识，sortBy + order 为后端查询参数 */
  readonly sorts: readonly ModuleSortType[];
  readonly defaultSort: string;
  readonly routes: ModuleRoutesType;
};

/** 用实际数据形态判别：书签无 source_type，Skill 必有 */
const isSkillItem = (item: ModuleItemType): item is SkillType => 'source_type' in item;

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
};

const titleOfItem = (item: ModuleItemType): string => (isSkillItem(item) ? item.name : item.title);

const dateOfItem = (item: ModuleItemType): string | null =>
  isSkillItem(item) ? asText(item.installed_at) : asText(item.created_at);

const updatedOfItem = (item: ModuleItemType): string | null => asText(item.updated_at);

const BOOKMARKS_MODULE = {
  key: 'bookmarks',
  label: '书签',
  noun: '项目',
  pagination: { count: '项目', size: '项目' },
  sectionLabel: '标签',
  dateLabel: '创建时间',
  titleLabel: '标题',
  addLabel: '添加',
  titleOf: titleOfItem,
  dateOf: dateOfItem,
  updatedOf: updatedOfItem,
  fields: [
    { key: 'url', label: '链接' },
    { key: 'tags', label: '标签' },
    { key: 'description', label: '描述' },
    { key: 'created_at', label: '创建时间' },
  ],
  sorts: [
    { key: 'created-desc', label: '创建时间（新→旧）', sortBy: 'created_at', order: 'desc' },
    { key: 'created-asc', label: '创建时间（旧→新）', sortBy: 'created_at', order: 'asc' },
    { key: 'title-asc', label: '标题（A→Z）', sortBy: 'title', order: 'asc' },
    { key: 'title-desc', label: '标题（Z→A）', sortBy: 'title', order: 'desc' },
    { key: 'updated-desc', label: '更新时间（新→旧）', sortBy: 'updated_at', order: 'desc' },
  ],
  defaultSort: 'created-desc',
  routes: {
    create: '/create-item',
    detail: null,
  },
} as const satisfies ModuleConfigType;

const SKILLS_MODULE = {
  key: 'skills',
  label: 'Skill',
  noun: 'Skill',
  pagination: { count: ' Skill', size: '条' },
  sectionLabel: '分类',
  dateLabel: '安装时间',
  titleLabel: '名称',
  addLabel: '安装 Skill',
  titleOf: titleOfItem,
  dateOf: dateOfItem,
  updatedOf: updatedOfItem,
  fields: [
    { key: 'description', label: '描述' },
    { key: 'tags', label: '标签' },
    { key: 'installed_at', label: '安装时间' },
    { key: 'fingerprint', label: '指纹' },
  ],
  sorts: [
    { key: 'installed-desc', label: '安装时间（新→旧）', sortBy: 'installed_at', order: 'desc' },
    { key: 'installed-asc', label: '安装时间（旧→新）', sortBy: 'installed_at', order: 'asc' },
    { key: 'name-asc', label: '名称（A→Z）', sortBy: 'name', order: 'asc' },
    { key: 'name-desc', label: '名称（Z→A）', sortBy: 'name', order: 'desc' },
    { key: 'updated-desc', label: '更新时间（新→旧）', sortBy: 'updated_at', order: 'desc' },
  ],
  defaultSort: 'installed-desc',
  routes: {
    create: null,
    detail: (id: number) => `/skills/${id}`,
  },
} as const satisfies ModuleConfigType;

/** 遍历顺序即侧栏模块顺序 */
export const MODULE_KEYS = ['bookmarks', 'skills'] as const satisfies readonly ModuleKey[];

export const DEFAULT_MODULE: ModuleKey = 'bookmarks';

export const MODULES: Record<ModuleKey, ModuleConfigType> = {
  bookmarks: BOOKMARKS_MODULE,
  skills: SKILLS_MODULE,
};

export type BookmarkFieldKey = (typeof BOOKMARKS_MODULE)['fields'][number]['key'];
export type SkillFieldKey = (typeof SKILLS_MODULE)['fields'][number]['key'];
export type ModuleFieldKey = BookmarkFieldKey | SkillFieldKey;

export type BookmarkSortKey = (typeof BOOKMARKS_MODULE)['sorts'][number]['key'];
export type SkillSortKey = (typeof SKILLS_MODULE)['sorts'][number]['key'];
export type ModuleSortKey = BookmarkSortKey | SkillSortKey;
