import { useContext, useEffect, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { CircleCheckIcon, ListTodo } from 'lucide-react';
import { StoreContext } from '@/store/storeContext.ts';
import { TodoToolbar } from '@/components/Todo/TodoToolbar.tsx';
import { TodoQuickAdd } from '@/components/Todo/TodoQuickAdd.tsx';
import { TodoRow } from '@/components/Todo/TodoRow.tsx';
import { TodoCard } from '@/components/Todo/TodoCard.tsx';
import { TodoDoneSection } from '@/components/Todo/TodoDoneSection.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { MODULES } from '@/lib/modules.ts';
import { getTodoDayLabel, sortTodosByDoneAt, type TodoDayLabel } from '@/lib/todoFormat.ts';
import { useUrlState } from '@/hooks/useUrlState.ts';
import { LayoutType, TodoType } from '@/lib/types.ts';
import { getSavedLayoutPreferenceForModule, saveLayoutPreferenceForModule } from '@/lib/utils.ts';

/** 列表布局的分段顺序（PRD §5.3 / T8）：固定「今天 → 昨天 → 更早」，空段不渲染 */
const DAY_ORDER: TodoDayLabel[] = ['今天', '昨天', '更早'];

/** 空态矩阵（PRD §5.8）：搜索无结果只出文案，其余带一枚示意图标 */
type TodoEmptyVariant = 'all-empty' | 'allclear' | 'done-empty' | 'search';

const TODO_EMPTY_META: Record<TodoEmptyVariant, { icon: typeof ListTodo | null; text: string }> = {
  'all-empty': { icon: ListTodo, text: '还没有待办，在上面写一条吧。' },
  allclear: { icon: CircleCheckIcon, text: '未完成的都处理完了，做得好。' },
  'done-empty': { icon: CircleCheckIcon, text: '还没有已完成的待办。' },
  search: { icon: null, text: '' },
};

const TodoEmptyState = ({ variant, keyword = '' }: { variant: TodoEmptyVariant; keyword?: string }) => {
  const { icon: Icon, text } = TODO_EMPTY_META[variant];
  const message = variant === 'search' ? `没有匹配「${keyword}」的待办。` : text;

  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 px-3 py-12 text-center">
      {Icon ? <Icon className="h-8 w-8 opacity-60" /> : null}
      <p className="text-sm sm:text-base">{message}</p>
    </div>
  );
};

/**
 * 待办列表外壳（PRD docs/prd/todo.md §5.1 / §5.7 / §5.8 / §6.3）。
 *
 * 参照账号库 `AccountVaultList` 的独立外壳模式：不走 `ModuleList` 的通用三布局，
 * 但仍是普通模块（路由 `/`），由 `ModuleList` 分发后挂在 Dashboard 内——
 * Dashboard 外壳由上层统一包裹，这里不再重复套壳。
 *
 * 渲染分四支（与原型 todoContentHtml 一致）：
 * 1. 搜索：在当前筛选范围内过滤，结果平铺（不分段、不折叠已完成），已完成项保留划线样式；
 * 2. 筛选「已完成」：只渲染已完成，无快速输入、无折叠区；
 * 3. 筛选「未完成」：只渲染未完成，无已完成折叠区；
 * 4. 默认：快速输入 + 未完成分段/卡片 + 底部已完成折叠区。
 */
export const TodoList = observer(() => {
  const store = useContext(StoreContext);
  const { searchParams } = useUrlState();

  /** 首屏加载态：进入待办模块时拉一次全量列表（首版不分页，PRD §8） */
  const [initialLoaded, setInitialLoaded] = useState(false);
  /** 布局按模块记忆（task4 的 layout-todos），首次进入用模块默认卡片（T3） */
  const [layout, setLayout] = useState<LayoutType>(() =>
    getSavedLayoutPreferenceForModule('todos', MODULES.todos.defaultLayout ?? 'cards')
  );
  /** 搜索态（工具栏输入即回调）：仅用于立即隐藏快速录入，避免等 URL 去抖；结果过滤取 URL 关键词 */
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

  /** 已完成数据源：按完成时间新→旧（search / 已完成筛选 / 折叠区共用同一排序口径） */
  const doneTodos = sortTodosByDoneAt(store.todos.filter((todo) => todo.done));

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
   * 删除单条待办：二次确认已在 TodoRow / TodoCard 内部用共享 DeleteDialog 完成，
   * 这里只执行删除；成功 toast 由 store.runRequest 按服务端 message 统一弹出。
   */
  const handleDelete = (id: number) => {
    void store.deleteTodo(id);
  };

  /** 清除全部已完成：二次确认已在已完成区内部完成，数据清空后折叠区随之消失 */
  const handleClearDone = () => {
    void store.clearDoneTodos();
  };

  /** 列表容器：行间 1px 分隔，整段包在圆角卡片里（PRD §5.3） */
  const renderList = (todos: TodoType[]) => (
    <div className="bg-card divide-y overflow-hidden rounded-lg border">
      {todos.map((todo) => (
        <TodoRow key={todo.id} todo={todo} onToggle={handleToggle} onDelete={handleDelete} />
      ))}
    </div>
  );

  /** 卡片容器（默认布局）：不分段，<672px 一列、≥672px 两列、≥1024px 三列（PRD §5.4） */
  const renderCards = (todos: TodoType[]) => (
    <div className="grid grid-cols-1 gap-2 sm:gap-3 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
      {todos.map((todo) => (
        <TodoCard key={todo.id} todo={todo} onToggle={handleToggle} onDelete={handleDelete} />
      ))}
    </div>
  );

  /** 搜索 / 已完成筛选的结果平铺：跟随当前布局，不做日期分段 */
  const renderFlat = (todos: TodoType[]) => (layout === 'list' ? renderList(todos) : renderCards(todos));

  /** 未完成区：列表按日期三段归组；卡片不分段平铺 */
  const openBody =
    layout === 'list' ? (
      <div className="flex flex-col gap-3 sm:gap-4">
        {segments.map(({ label, todos }) =>
          todos.length === 0 ? null : (
            <section key={label}>
              <h2 className="text-muted-foreground px-1 pb-2 text-xs font-semibold tracking-wide">{label}</h2>
              {renderList(todos)}
            </section>
          )
        )}
      </div>
    ) : (
      renderCards(openTodos)
    );

  /** 搜索关键词以 URL 为唯一事实源（工具栏 300ms 去抖写入），这里只读 */
  const keyword = (searchParams.get('search') ?? '').trim();
  const filter = store.todoFilter;

  let content: ReactNode;

  if (keyword) {
    // 搜索范围 = 当前筛选范围；不区分大小写，结果平铺且不折叠已完成（PRD §5.7）
    const base = filter === 'open' ? openTodos : filter === 'done' ? doneTodos : [...openTodos, ...doneTodos];
    const query = keyword.toLowerCase();
    const hits = base.filter((todo) => todo.text.toLowerCase().includes(query));

    content =
      hits.length === 0 ? (
        <TodoEmptyState variant="search" keyword={keyword} />
      ) : (
        <>
          <p className="text-muted-foreground px-1 text-xs">
            搜索「{keyword}」，共 {hits.length} 条
          </p>
          {renderFlat(hits)}
        </>
      );
  } else if (filter === 'done') {
    // 只看已完成：无快速输入、无未完成区、不折叠，直接平铺（PRD §5.2 / §5.8）
    content = doneTodos.length === 0 ? <TodoEmptyState variant="done-empty" /> : renderFlat(doneTodos);
  } else if (filter === 'open') {
    // 只看未完成：不渲染已完成折叠区
    content = (
      <>
        <TodoQuickAdd searching={searching} />
        {openTodos.length === 0 ? <TodoEmptyState variant="allclear" /> : openBody}
      </>
    );
  } else {
    // 默认视图：快速输入 + 未完成区 + 底部已完成折叠区（都为空时给首次使用引导）
    content = (
      <>
        <TodoQuickAdd searching={searching} />
        {openTodos.length === 0 ? (
          <TodoEmptyState variant={doneTodos.length === 0 ? 'all-empty' : 'allclear'} />
        ) : (
          openBody
        )}
        {/* 为空时不挂载（而非仅返回 null），这样清空后再次产生完成项会回到收起态 */}
        {doneTodos.length > 0 ? (
          <TodoDoneSection
            todos={doneTodos}
            layout={layout}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onClearDone={handleClearDone}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TodoToolbar
        layout={layout}
        onLayoutChange={updateLayout}
        onSearchChange={(value) => setSearching(value.trim().length > 0)}
      />

      <div className="no-scrollbar h-full min-h-0 flex-1 overflow-x-clip overflow-y-auto">
        {/* 内容区最大宽度约 56rem 居中（PRD §5.9）；移动端收紧 padding 与间距 */}
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-1.5 px-3 py-3 sm:gap-2 sm:px-4 sm:py-4">
          {initialLoaded ? (
            content
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
