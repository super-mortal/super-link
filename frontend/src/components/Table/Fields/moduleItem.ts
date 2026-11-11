import type { ModuleItemType } from '@/lib/modules.ts';
import type { AccountType, SkillType } from '@/lib/types.ts';

/** 用实际数据形态判别：书签无 source_type，Skill 必有 */
export const isSkillItem = (item: ModuleItemType): item is SkillType => 'source_type' in item;

/** 账号判别：账号必有 platform，书签 / Skill 没有该字段 */
export const isAccountItem = (item: ModuleItemType): item is AccountType => 'platform' in item;

/** 账号不走书签 / Skill 的标签体系（PRD §5.1.1），永远返回空 */
export const tagIDsOf = (item: ModuleItemType): number[] => (isAccountItem(item) ? [] : (item.tags ?? []));

/** 卡片 / 列表里展示的日期只取到天，保持同一行高度可控 */
export const formatCardDate = (value: string | null): string => (value ? value.slice(0, 10) : '—');

/** 省略协议的链接无法直接打开，统一补全后再作为外链 */
export const normalizedSourceURL = (url: string): string => (url.startsWith('http') ? url : `https://${url}`);
