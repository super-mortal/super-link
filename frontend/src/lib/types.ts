import z from 'zod';

export type CreateUserType = {
  username: string;
  password: string;
  confirm_password: string;
};

export type LoginType = {
  username: string;
  password: string;
};

export type UpdateUsernameType = {
  username: string;
};

export type UserType = {
  id: number;
  username: string;
};

export type UpdatePasswordType = {
  password: string;
  confirm_password: string;
};

export const UrlSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL is required' })
  .transform((val) => (val.includes(':') ? val : `https://${val}`))
  .pipe(z.url());

export const ItemSchema = z.object({
  id: z.any().optional(),
  title: z.string().min(1, { message: 'Title is required' }),
  url: UrlSchema,
  description: z.string().optional(),
  comments: z.string().optional(),
  tags: z.array(z.any()).optional(),
  created_at: z.any().optional(),
  updated_at: z.any().optional(),
});

export type ItemType = z.infer<typeof ItemSchema>;

export type TagType = {
  id: number;
  parent: number;
  title: string;
  description?: string;
  color: string;
  pinned: boolean;
  created_at: string;
  updated_at: string | null;
  fullPath: string;
  fullPathIDs: string;
};
export type TagsObjectType = Record<number, TagType>;

export type LayoutType = 'table' | 'cards' | 'list';

export type TagFilterType = number | 'none' | null;

export type ModuleKey = 'bookmarks' | 'skills';

export type SkillSourceType = 'github' | 'upload';

export type SkillType = {
  id: number;
  name: string;
  description: string;
  source_type: SkillSourceType;
  source_url: string;
  fingerprint: string;
  installed_at: string;
  updated_at: string | null;
  tags: number[];
  /** 前端态：check-updates 返回有更新时标记，不落库 */
  hasUpdate?: boolean;
  /** 前端态：刚安装完成，卡片高亮 2s 后清除，不落库 */
  justInstalled?: boolean;
};

export type SkillFileType = {
  name: string;
  type: 'file' | 'dir';
  count?: number;
};

export type SkillDetailType = {
  skill: SkillType;
  content: string;
  files: SkillFileType[];
};

/** check-updates 返回的有更新项 */
export type SkillUpdateType = {
  id: number;
  name: string;
  current: string;
  latest: string;
};
