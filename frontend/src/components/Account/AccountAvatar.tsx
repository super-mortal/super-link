import type { ComponentType } from 'react';
import { IconBrandGithub, IconBrandGoogle, IconBrandWindows, IconBrandX } from '@tabler/icons-react';
import { cn } from '@/lib/utils.ts';
import { platformBrandColorClass, platformBrandKey, type PlatformBrandKey } from '@/lib/accountFormat.ts';

/**
 * 品牌 key → tabler 品牌图标。key 来自 `lib/accountFormat.ts` 的 `platformBrandKey`，
 * 这里只做「品牌 → 图标」的渲染映射；平台名匹配逻辑仍然只有 accountFormat 那一份。
 */
const BRAND_ICONS: Record<PlatformBrandKey, ComponentType<{ className?: string }>> = {
  github: IconBrandGithub,
  google: IconBrandGoogle,
  microsoft: IconBrandWindows,
  x: IconBrandX,
};

/**
 * 账号卡片头像（refinements.md §3）：常用平台显示品牌 Logo，其余平台回退「中性色底 + 平台首字母」。
 *
 * 品牌 Logo 容器用 `bg-secondary` + `text-foreground` 而非品牌实色底：GitHub / X 这类
 * 深色 Logo 在暗色主题下会与深色底融为一体，中性底 + currentColor 才能保证明暗都可读
 * （原型 styles.css 的 `.acc-avatar.brand` 也是同一处理）。未知平台的底色取自
 * accountFormat 的中性回退色，字母用 `text-background` 保证与底色对比度。
 */
export const AccountAvatar = ({ platform, className }: { platform: string; className?: string }) => {
  const brandKey = platformBrandKey(platform);
  const BrandIcon = brandKey ? BRAND_ICONS[brandKey] : null;
  const initial = platform.trim().charAt(0).toUpperCase();

  return (
    <span
      role="img"
      aria-label={platform}
      title={platform}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
        brandKey
          ? 'bg-secondary text-foreground border-border'
          : cn(platformBrandColorClass(platform), 'text-background border-transparent'),
        className
      )}
    >
      {BrandIcon ? (
        <BrandIcon className="h-[18px] w-[18px]" />
      ) : (
        <span className="text-xs font-semibold">{initial || '?'}</span>
      )}
    </span>
  );
};
