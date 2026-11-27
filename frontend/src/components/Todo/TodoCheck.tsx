import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils.ts';

type TodoCheckProps = {
  checked: boolean;
  className?: string;
};

/**
 * 圆形勾选指示器（PRD §5.9）：待办刻意用圆形，区别于书签 / 表格的方形复选框；
 * 选中态用 --primary 填充 + 白色勾，暗色主题随语义 token 自动适配。
 *
 * 只做展示、不渲染成可聚焦控件：交互语义由外层整行 / 整卡的 role="checkbox" 承担，
 * 避免同一个勾选动作出现两个焦点目标。
 */
export const TodoCheck = ({ checked, className }: TodoCheckProps) => (
  <span
    aria-hidden="true"
    className={cn(
      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/55 text-transparent',
      className
    )}
  >
    <CheckIcon className="h-3 w-3" strokeWidth={3} />
  </span>
);
