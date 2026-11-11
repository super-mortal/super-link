import type { AccountType, ItemType, ModuleKey, SkillType } from '@/lib/types.ts';

/**
 * 模块注册表：书签 / Skill / 账号库的全部差异（标题、日期、字段、排序、路由、文案）都在这里，
 * 侧栏、工具栏、卡片、列表、表格、分页统一以 ModuleConfigType 签名消费，不再各自判断模块。
 *
 * 账号库的数据形态与另外两个模块不同（独立表与接口，PRD §5.1.1），但配置签名保持一致：
 * 侧栏与后续的 Account* 布局（PRD §9.3）复用同一份配置。
 */
export type ModuleItemType = ItemType | SkillType | AccountType;

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

/** 账号判别：账号必有 platform，书签 / Skill 没有该字段 */
const isAccountItem = (item: ModuleItemType): item is AccountType => 'platform' in item;

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
};

const titleOfItem = (item: ModuleItemType): string => {
  if (isAccountItem(item)) {
    return item.name;
  }
  return isSkillItem(item) ? item.name : item.title;
};

const dateOfItem = (item: ModuleItemType): string | null => {
  // 账号库的「日期」取更新时间（dateLabel 为「更新时间」），与默认排序保持一致
  if (isAccountItem(item)) {
    return asText(item.updated_at);
  }
  return isSkillItem(item) ? asText(item.installed_at) : asText(item.created_at);
};

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

/**
 * 账号库（PRD §9.1）。字段里的密码 / 2FA / 备注都是密文字段：
 * 布局只渲染状态与掩码，明文按需拉详情解密后进 vaultSession 内存缓存。
 */
const ACCOUNTS_MODULE = {
  key: 'accounts',
  label: '账号库',
  noun: '账号',
  pagination: { count: '账号', size: '条' },
  sectionLabel: '平台',
  dateLabel: '更新时间',
  titleLabel: '账号',
  addLabel: '添加账号',
  titleOf: titleOfItem,
  dateOf: dateOfItem,
  updatedOf: updatedOfItem,
  fields: [
    { key: 'platform', label: '平台' },
    { key: 'identifier', label: '账号标识' },
    { key: 'password', label: '密码' },
    { key: 'totp', label: '2FA' },
    { key: 'authorizations', label: '授权' },
    { key: 'notes', label: '备注' },
  ],
  // sortBy 与后端 Repository::ACCOUNT_SORTS 白名单列名一一对应（PRD §8.2）
  sorts: [
    { key: 'updated-desc', label: '更新时间（新→旧）', sortBy: 'updated_at', order: 'desc' },
    { key: 'created-desc', label: '创建时间（新→旧）', sortBy: 'created_at', order: 'desc' },
    { key: 'name-asc', label: '名称（A→Z）', sortBy: 'name', order: 'asc' },
    { key: 'platform-asc', label: '平台（A→Z）', sortBy: 'platform', order: 'asc' },
    { key: 'password-updated-asc', label: '密码最久未改', sortBy: 'password_updated_at', order: 'asc' },
  ],
  defaultSort: 'updated-desc',
  routes: {
    // 新建走弹窗，不占路由
    create: null,
    detail: (id: number) => `/accounts/${id}`,
  },
} as const satisfies ModuleConfigType;

/** 遍历顺序即侧栏模块顺序 */
export const MODULE_KEYS = ['bookmarks', 'skills', 'accounts'] as const satisfies readonly ModuleKey[];

export const DEFAULT_MODULE: ModuleKey = 'bookmarks';

export const MODULES: Record<ModuleKey, ModuleConfigType> = {
  bookmarks: BOOKMARKS_MODULE,
  skills: SKILLS_MODULE,
  accounts: ACCOUNTS_MODULE,
};

export type BookmarkFieldKey = (typeof BOOKMARKS_MODULE)['fields'][number]['key'];
export type SkillFieldKey = (typeof SKILLS_MODULE)['fields'][number]['key'];
export type AccountFieldKey = (typeof ACCOUNTS_MODULE)['fields'][number]['key'];
export type ModuleFieldKey = BookmarkFieldKey | SkillFieldKey | AccountFieldKey;

export type BookmarkSortKey = (typeof BOOKMARKS_MODULE)['sorts'][number]['key'];
export type SkillSortKey = (typeof SKILLS_MODULE)['sorts'][number]['key'];
export type AccountSortKey = (typeof ACCOUNTS_MODULE)['sorts'][number]['key'];
export type ModuleSortKey = BookmarkSortKey | SkillSortKey | AccountSortKey;
