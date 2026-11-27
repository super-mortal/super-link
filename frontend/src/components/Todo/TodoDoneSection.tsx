import { useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { TodoRow } from '@/components/Todo/TodoRow.tsx';
import { TodoCard } from '@/components/Todo/TodoCard.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { cn } from '@/lib/utils.ts';
import type { LayoutType, TodoType } from '@/lib/types.ts';

type TodoDoneSectionProps = {
  /** 已完成待办（由外壳从 store.todos 过滤而来） */
  todos: TodoType[];
  /** 跟随当前布局：list 渲染 TodoRow、cards 渲染 TodoCard（PRD §5.4） */
  layout: LayoutType;
  /** 切换完成：在已完成区点击即取消完成，回到未完成区对应分段 */
  onToggle: (id: number, done: boolean) => void;
  /** 单条删除：二次确认已在行 / 卡片内部接入 */
  onDelete: (id: number) => void;
  /** 清除全部已完成（二次确认在本组件内完成） */
  onClearDone: () => void;
};

/** 展开面板的 id：供标题按钮 aria-controls 指向，保证可访问性 */
const PANEL_ID = 'todo-done-panel';

/**
 * 已完成折叠区（PRD docs/prd/todo.md §5.5 / T4 / T13）。
 *
 * 默认收起，点击标题展开 / 收起；展开后按完成时间新→旧排列（done_at 为空时兜底 created_at）。
 * 已完成项复用未完成区的行 / 卡片组件，划线 + muted 样式由 done 状态驱动，时间仍展示创建时间。
 * 展开状态只是页面本地 state，不写 URL、不持久化。
 */
export const TodoDoneSection = ({ todos, layout, onToggle, onDelete, onClearDone }: TodoDoneSectionProps) => {
  const [expanded, setExpanded] = useState(false);

  if (todos.length === 0) {
    return null;
  }

  // 完成时间新→旧；done_at 为空（历史数据兜底）退回 created_at，
  // 两者同为 'Y-m-d H:i:s' 字符串，可直接按字典序比较，避免时区二次换算
  const doneTodos = [...todos].sort((a, b) => (b.done_at ?? b.created_at).localeCompare(a.done_at ?? a.created_at));

  return (
    <section className="mt-1 border-t pt-1" aria-label="已完成待办">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={PANEL_ID}
          onClick={() => setExpanded((value) => !value)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ChevronRightIcon className={cn('h-4 w-4 shrink-0 transition-transform', expanded && 'rotate-90')} />
          <span className="truncate">已完成 {todos.length}</span>
        </button>
        <DeleteDialog
          itemsCount={todos.length}
          noun="待办"
          description={`将删除 ${todos.length} 条已完成待办，此操作无法撤销。`}
          onConfirm={onClearDone}
        >
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive focus-visible:ring-ring shrink-0 rounded-md px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            清除已完成
          </button>
        </DeleteDialog>
      </div>

      {expanded ? (
        layout === 'list' ? (
          <div id={PANEL_ID} className="bg-card mt-1 divide-y overflow-hidden rounded-lg border">
            {doneTodos.map((todo) => (
              <TodoRow key={todo.id} todo={todo} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        ) : (
          <div id={PANEL_ID} className="mt-1 grid grid-cols-1 gap-3 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
            {doneTodos.map((todo) => (
              <TodoCard key={todo.id} todo={todo} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
};
