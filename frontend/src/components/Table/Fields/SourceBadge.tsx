import * as React from 'react';
import { Github, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge.tsx';
import { cn } from '@/lib/utils.ts';
import type { SkillSourceType } from '@/lib/types.ts';

/** Skill 卡片 / 列表的标题行来源徽章（书签不显示任何徽章） */
export const SourceBadge = ({ sourceType }: { sourceType: SkillSourceType }) => {
  const isGitHub = sourceType === 'github';

  return (
    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[11px] font-normal">
      {isGitHub ? <Github /> : <Upload />}
      {isGitHub ? 'GitHub' : '上传'}
    </Badge>
  );
};

/** 「有更新」标记：黄色底走明暗两套色阶，不写死 hex */
export const UpdateBadge = () => (
  <Badge
    variant="outline"
    className="border-amber-500/40 bg-amber-500/15 px-1.5 py-0 text-[11px] font-medium text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300"
  >
    有更新
  </Badge>
);

/** 链接 / 来源行：书签传链接，Skill 传来源地址，本地上传只传文本 */
export const ItemSourceLine = ({ text, href, className }: { text: string; href?: string; className?: string }) => (
  <div className={cn('text-muted-foreground truncate text-sm', className)}>
    {href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="decoration-border hover:text-foreground underline underline-offset-2"
      >
        {text}
      </a>
    ) : (
      text
    )}
  </div>
);
