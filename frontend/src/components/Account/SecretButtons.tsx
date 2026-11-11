import { Copy, Eye } from 'lucide-react';
import { cn } from '@/lib/utils.ts';

const secretButtonClass =
  'text-muted-foreground hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent';

/** 行内小复制按钮：账号标识 / 密码右侧共用；点击不冒泡到整行（整行可跳详情） */
export const CopySecretButton = ({
  onCopy,
  label,
  className,
}: {
  onCopy: () => void;
  /** 无障碍与悬浮标题，如「复制账号标识」「复制密码」 */
  label: string;
  className?: string;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={cn(secretButtonClass, className)}
    onClick={(event) => {
      event.stopPropagation();
      onCopy();
    }}
  >
    <Copy className="h-3.5 w-3.5" />
  </button>
);

/** 「显示明文」按钮：task10 接入按需解密后变为掩码 / 明文切换，本任务只给占位提示 */
export const RevealSecretButton = ({ onReveal, label = '显示明文' }: { onReveal: () => void; label?: string }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={secretButtonClass}
    onClick={(event) => {
      event.stopPropagation();
      onReveal();
    }}
  >
    <Eye className="h-3.5 w-3.5" />
  </button>
);

/**
 * 定长密码掩码：位数固定不反映真实长度，避免通过点数推断密码长短（PRD §7.4）。
 */
export const PasswordMask = () => (
  <span className="text-muted-foreground tracking-[0.2em] select-none" aria-label="密码已隐藏">
    ••••••••
  </span>
);
