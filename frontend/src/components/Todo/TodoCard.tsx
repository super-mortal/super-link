import { Trash2Icon } from 'lucide-react';
import { TodoCheck } from '@/components/Todo/TodoCheck.tsx';
import { formatTodoTime } from '@/lib/todoFormat.ts';
import { cn } from '@/lib/utils.ts';
import type { TodoType } from '@/lib/types.ts';

type TodoCardProps = {
  todo: TodoType;
  /** 切换完成：由外壳直达 store.updateTodo，成功后该卡自动离开未完成区 */
  onToggle: (id: number, done: boolean) => void;
  /** 删除动作：二次确认由父级（task7）统一接入，本组件只负责触发 */
  onDelete: (id: number) => void;
};

/**
 * 未完成待办卡片（卡片布局，PRD §5.4 / T10 / T12）。
 *
 * 结构固定为「头部：圆形勾选框 + 完整时间 + 悬浮删除 → 正文文字（可多行）」。
 * 整卡点击即切换完成，删除按钮 stopPropagation 隔离，避免一次点击既删又勾。
 */
export const TodoCard = ({ todo, onToggle, onDelete }: TodoCardProps) => {
  const toggle = () => onToggle(todo.id, !todo.done);

  return (
    <div
      role="checkbox"
      aria-checked={todo.done}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(event) => {
        // 删除按钮上的 Enter / Space 不应再冒泡触发整卡切换
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
      className="onhover-container from-muted/70 to-card hover:border-muted-foreground/40 focus-visible:outline-ring flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border bg-gradient-to-t p-3.5 transition-[box-shadow,border-color] hover:shadow-md focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <div className="flex min-h-5 items-center gap-2">
        <TodoCheck checked={todo.done} />
        <span className="text-muted-foreground min-w-0 text-xs whitespace-nowrap tabular-nums">
          {formatTodoTime(todo.created_at)}
        </span>
        <button
          type="button"
          aria-label="删除待办"
          onClick={(event) => {
            // 删除不是切换完成：拦住冒泡，避免点删除同时把待办勾掉
            event.stopPropagation();
            onDelete(todo.id);
          }}
          className="onhover-visible text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-ring ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Trash2Icon className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className={cn('text-[15px] leading-relaxed wrap-anywhere', todo.done && 'text-muted-foreground line-through')}>
        {todo.text}
      </p>
    </div>
  );
};
