import { Copy, Eye, EyeOff } from 'lucide-react';
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

/**
 * 「显示 / 隐藏明文」按钮（掩码 ⇄ 明文切换，PRD §7.4）。
 * revealed 为 true 时切换为「隐藏」图标与文案；列表态的占位调用只传 onReveal。
 */
export const RevealSecretButton = ({
  onReveal,
  label,
  revealed = false,
}: {
  onReveal: () => void;
  label?: string;
  revealed?: boolean;
}) => {
  const title = label ?? (revealed ? '隐藏明文' : '显示明文');
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      className={secretButtonClass}
      onClick={(event) => {
        event.stopPropagation();
        onReveal();
      }}
    >
      {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
};

/**
 * 定长密码掩码：位数固定不反映真实长度，避免通过点数推断密码长短（PRD §7.4）。
 */
export const PasswordMask = () => (
  <span className="text-muted-foreground tracking-[0.2em] select-none" aria-label="密码已隐藏">
    ••••••••
  </span>
);
