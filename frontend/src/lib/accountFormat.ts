/**
 * 账号库详情页的纯格式化 helper（PRD §10.4 / §10.5）。
 *
 * 只放「数据 → 展示文本」的纯函数：相对时间、密码年龄、待处理判定；
 * 组件不直接写底层逻辑，便于复用与单独验证（dev-spec §9.7）。
 *
 * 时区说明：后端时间文本是 `Y-m-d H:i:s`（服务器本地时间，个人自托管部署通常与
 * 使用者同一时区），这里按浏览器本地时间解析；跨时区访问最多偏差数小时，
 * 不影响「N 天前」这类粗粒度展示与 365 天陈旧判定。
 */

import type { AccountType } from '@/lib/types.ts';

/** 密码超过该天数未修改即视为「待处理」（PRD §10.4：超过 365 天未改） */
export const PASSWORD_STALE_DAYS = 365;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const parseAccountDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  // 后端写的是 "YYYY-MM-DD HH:MM:SS"（空格分隔）：补 "T" 转 ISO 本地时间，
  // 避免各浏览器对空格格式的解析分歧（Safari 按 UTC、Chrome 按本地）
  const date = new Date(value.trim().replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 只取日期部分（YYYY-MM-DD）；缺失返回「—」，与列表卡片口径一致 */
export const formatAccountDate = (value: string | null | undefined): string => (value ? value.slice(0, 10) : '—');

/**
 * 相对过去的粗粒度中文描述：刚刚 / N 分钟前 / N 小时前 / N 天前 / N 个月前 / N 年前。
 * 未来时间（时钟偏差、服务端时间不准）按「刚刚」处理，不展示负数。
 */
export const formatRelativePast = (value: string | null | undefined): string | null => {
  const date = parseAccountDate(value);
  if (!date) {
    return null;
  }
  const elapsed = Date.now() - date.getTime();
  if (elapsed < MINUTE_MS) {
    return '刚刚';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)} 小时前`;
  }
  if (elapsed < 30 * DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)} 天前`;
  }
  if (elapsed < 365 * DAY_MS) {
    return `${Math.floor(elapsed / (30 * DAY_MS))} 个月前`;
  }
  return `${Math.floor(elapsed / (365 * DAY_MS))} 年前`;
};

/** 密码距上次修改的天数；没有密码密文或没有更新时间时返回 null（不猜测） */
export const passwordAgeDays = (account: AccountType): number | null => {
  if (!account.secrets?.password) {
    return null;
  }
  const date = parseAccountDate(account.password_updated_at);
  if (!date) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS));
};

/**
 * 是否「待处理」（PRD §10.4）：未开 2FA，或密码超过 365 天未修改。
 * 没有密码密文的账号（第三方登录）不参与密码陈旧判定——它本来就没有密码可改。
 */
export const isAccountPending = (account: AccountType): boolean => {
  if (!account.secrets?.totp) {
    return true;
  }
  const ageDays = passwordAgeDays(account);
  return ageDays !== null && ageDays > PASSWORD_STALE_DAYS;
};

/**
 * 平台 → 品牌映射（refinements.md §2.2 / §3）。
 *
 * 品牌色是**有意的例外**：它是品牌识别色，不参与主题 token 体系（不随 light / dark
 * 语义变量走），只用于侧栏平台色点与账号卡片品牌头像的视觉识别，**不参与筛选逻辑**。
 * 全项目只允许这一份映射：NavPlatforms 与账号卡片都必须调用这里导出的函数，
 * 禁止在组件里再写一份 switch / map（否则同一平台会出现两种颜色 / 两种图标）。
 *
 * brandKey 供品牌 Logo 使用（`AccountAvatar` 据此选图标），colorClass 供色点与
 * 未知平台头像底色使用；两者同源，避免规则漂移。
 *
 * 用 Tailwind 调色板类而非十六进制：暗色主题下深色品牌色不可见，需要换成浅一档，
 * 与 serverFormat.ts 的 SERVER_STATUS 同一口径；调用方不再追加 dark: 变体。
 */
export type PlatformBrandKey = 'github' | 'google' | 'microsoft' | 'x';

const PLATFORM_BRAND_RULES: { brandKey: PlatformBrandKey; aliases: string[]; colorClass: string }[] = [
  { brandKey: 'github', aliases: ['github'], colorClass: 'bg-neutral-800 dark:bg-neutral-200' },
  { brandKey: 'google', aliases: ['google', 'gmail'], colorClass: 'bg-blue-500' },
  { brandKey: 'microsoft', aliases: ['microsoft', 'outlook', 'azure'], colorClass: 'bg-blue-600' },
  { brandKey: 'x', aliases: ['x', 'twitter'], colorClass: 'bg-neutral-500 dark:bg-neutral-400' },
];

/** 未知平台的中性回退色：固定值，不用随机色（同一平台每次渲染颜色必须一致） */
export const PLATFORM_BRAND_FALLBACK_CLASS = 'bg-muted-foreground';

/**
 * 品牌规则匹配的唯一入口（色点与品牌 Logo 共用）。
 *
 * 归一化：去首尾空格 + 转小写；按别名做「等值或前缀 + 空格」匹配，
 * 兼容「GitHub Enterprise」「Google Workspace」「Microsoft 365」「Twitter (X)」这类带后缀的平台名。
 */
const matchPlatformBrandRule = (platform: string) => {
  const name = platform.trim().toLowerCase();
  if (name === '') {
    return undefined;
  }

  return PLATFORM_BRAND_RULES.find((rule) =>
    rule.aliases.some((alias) => name === alias || name.startsWith(`${alias} `))
  );
};

/** 平台名 → 品牌色类（侧栏色点 / 未知平台头像底色）；不认识的平台回退中性色 */
export const platformBrandColorClass = (platform: string): string =>
  matchPlatformBrandRule(platform)?.colorClass ?? PLATFORM_BRAND_FALLBACK_CLASS;

/** 平台名 → 品牌 key（账号卡片头像据此显示品牌 Logo）；非品牌平台返回 null */
export const platformBrandKey = (platform: string): PlatformBrandKey | null =>
  matchPlatformBrandRule(platform)?.brandKey ?? null;
