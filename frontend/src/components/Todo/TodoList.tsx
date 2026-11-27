import { useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '@/store/storeContext.ts';
import { TodoToolbar } from '@/components/Todo/TodoToolbar.tsx';
import { TodoQuickAdd } from '@/components/Todo/TodoQuickAdd.tsx';
import { TodoRow } from '@/components/Todo/TodoRow.tsx';
import { TodoCard } from '@/components/Todo/TodoCard.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { MODULES } from '@/lib/modules.ts';
import { getTodoDayLabel, type TodoDayLabel } from '@/lib/todoFormat.ts';
import { LayoutType } from '@/lib/types.ts';
import { getSavedLayoutPreferenceForModule, saveLayoutPreferenceForModule } from '@/lib/utils.ts';

/** 列表布局的分段顺序（PRD §5.3 / T8）：固定「今天 → 昨天 → 更早」，空段不渲染 */
const DAY_ORDER: TodoDayLabel[] = ['今天', '昨天', '更早'];

/**
 * 待办列表外壳（PRD docs/prd/todo.md §5.1 / §6.3）。
 *
 * 参照账号库 `AccountVaultList` 的独立外壳模式：不走 `ModuleList` 的通用三布局，
 * 但仍是普通模块（路由 `/`），由 `ModuleList` 分发后挂在 Dashboard 内——
 * Dashboard 外壳由上层统一包裹，这里不再重复套壳。
 *
 * 本任务已接入未完成区（列表日期分段 / 卡片响应式平铺）；已完成折叠区、
 * 搜索过滤与空态矩阵仍由后续任务接入。
 */
export const TodoList = observer(() => {
  const store = useContext(StoreContext);

  /** 首屏加载态：进入待办模块时拉一次全量列表（首版不分页，PRD §8） */
  const [initialLoaded, setInitialLoaded] = useState(false);
  /** 布局按模块记忆（task4 的 layout-todos），首次进入用模块默认卡片（T3） */
  const [layout, setLayout] = useState<LayoutType>(() =>
    getSavedLayoutPreferenceForModule('todos', MODULES.todos.defaultLayout ?? 'cards')
  );
  /** 搜索是否为非空（工具栏回调同步）：仅用于隐藏快速录入，结果过滤属于后续任务 */
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    // 切模块会卸载本组件：用 active 标记避免卸载后 setState
    let active = true;

    const load = async () => {
      await store.fetchTodos();
      if (active) {
        setInitialLoaded(true);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [store]);

  const updateLayout = (next: LayoutType) => {
    setLayout(next);
    saveLayoutPreferenceForModule('todos', next);
  };

  /** 未完成数据源：只用 store.todos 派生，不在前端另存副本（完成后行随 store 自动离开） */
  const openTodos = store.todos.filter((todo) => !todo.done);

  /** 列表分段：按 Asia/Shanghai 日期归组，空段在后面被过滤掉 */
  const segments = DAY_ORDER.map((label) => ({
    label,
    todos: openTodos.filter((todo) => getTodoDayLabel(todo.created_at) === label),
  }));

  /** 切换完成：乐观更新与失败回滚都在 store 里完成，这里只发动作 */
  const handleToggle = (id: number, done: boolean) => {
    void store.updateTodo(id, done);
  };

  /**
   * 删除占位：单条删除必须二次确认（PRD T13），确认弹窗由 task7 接入，
   * 本任务先直达 store，保证删除按钮的点击链路可验证。
   */
  const handleDelete = (id: number) => {
    void store.deleteTodo(id);
  };

  return (
    <div className="flex h-full flex-col">
      <TodoToolbar
        layout={layout}
        onLayoutChange={updateLayout}
        onSearchChange={(value) => setSearching(value.trim().length > 0)}
      />

      <div className="no-scrollbar h-full min-h-0 flex-1 overflow-x-clip overflow-y-auto">
        {/* 内容区最大宽度约 56rem 居中（PRD §5.9），宽屏不拉满 */}
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-4">
          {initialLoaded ? (
            <>
              <TodoQuickAdd searching={searching} />
              {layout === 'list' ? (
                /* 列表布局：按日期三段归组，每段小标题 + 圆角容器包住该段所有行（行间 1px 分隔） */
                <div className="mt-1 flex flex-col gap-4">
                  {segments.map(({ label, todos }) =>
                    todos.length === 0 ? null : (
                      <section key={label}>
                        <h2 className="text-muted-foreground px-1 pb-2 text-xs font-semibold tracking-wide">{label}</h2>
                        <div className="bg-card divide-y overflow-hidden rounded-lg border">
                          {todos.map((todo) => (
                            <TodoRow key={todo.id} todo={todo} onToggle={handleToggle} onDelete={handleDelete} />
                          ))}
                        </div>
                      </section>
                    )
                  )}
                </div>
              ) : (
                /* 卡片布局（默认）：不分段，按创建时间新→旧平铺；容器断点 672px 两列、1024px 三列 */
                <div className="mt-1 grid grid-cols-1 gap-3 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
                  {openTodos.map((todo) => (
                    <TodoCard key={todo.id} todo={todo} onToggle={handleToggle} onDelete={handleDelete} />
                  ))}
                </div>
              )}
              {/* 已完成折叠区：task7 / task9 接入 */}
            </>
          ) : (
            <>
              <Skeleton className="h-12 w-full rounded-lg" />
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
