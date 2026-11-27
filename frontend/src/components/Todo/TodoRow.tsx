import { Trash2Icon } from 'lucide-react';
import { TodoCheck } from '@/components/Todo/TodoCheck.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { formatTodoTime } from '@/lib/todoFormat.ts';
import { cn } from '@/lib/utils.ts';
import type { TodoType } from '@/lib/types.ts';

type TodoRowProps = {
  todo: TodoType;
  /** 切换完成：由外壳直达 store.updateTodo，成功后该行自动离开未完成区 */
  onToggle: (id: number, done: boolean) => void;
  /** 删除动作：二次确认由父级（task7）统一接入，本组件只负责触发 */
  onDelete: (id: number) => void;
};

/**
 * 未完成待办行（列表布局，PRD §5.3 / T10 / T12）。
 *
 * 整行是 role="checkbox" 的可聚焦元素：点击任意位置（删除按钮除外）即切换完成，
 * 不提供任何编辑入口（避免「点文字进编辑」的误操作）。
 * 时间固定输出完整 'YYYY-MM-DD HH:mm'，分段标题只负责归组，不省略日期。
 */
export const TodoRow = ({ todo, onToggle, onDelete }: TodoRowProps) => {
  const toggle = () => onToggle(todo.id, !todo.done);

  return (
    <div
      role="checkbox"
      aria-checked={todo.done}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(event) => {
        // 删除按钮上的 Enter / Space 不应再冒泡触发行切换，只处理行自身按键
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
      className="onhover-container hover:bg-muted/30 focus-visible:outline-ring relative flex min-h-12 cursor-pointer items-center gap-3 py-2.5 pr-12 pl-3.5 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <TodoCheck checked={todo.done} />
      <span
        className={cn(
          'min-w-0 flex-1 text-[15px] leading-relaxed wrap-anywhere',
          todo.done && 'text-muted-foreground line-through'
        )}
      >
        {todo.text}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap tabular-nums">
        {formatTodoTime(todo.created_at)}
      </span>
      <DeleteDialog
        itemsCount={1}
        noun="这条待办"
        description={`「${todo.text}」删除后无法恢复。`}
        onConfirm={() => onDelete(todo.id)}
      >
        <button
          type="button"
          aria-label="删除待办"
          onClick={(event) => {
            // 删除不是切换完成：拦住冒泡，避免点删除同时把待办勾掉（对话框由 DeleteDialog 触发器打开）
            event.stopPropagation();
          }}
          className="onhover-visible text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-ring absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Trash2Icon className="h-3.5 w-3.5" />
        </button>
      </DeleteDialog>
    </div>
  );
};
