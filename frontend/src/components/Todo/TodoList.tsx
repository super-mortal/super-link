import { useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '@/store/storeContext.ts';
import { TodoToolbar } from '@/components/Todo/TodoToolbar.tsx';
import { TodoQuickAdd } from '@/components/Todo/TodoQuickAdd.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { MODULES } from '@/lib/modules.ts';
import { LayoutType } from '@/lib/types.ts';
import { getSavedLayoutPreferenceForModule, saveLayoutPreferenceForModule } from '@/lib/utils.ts';

/**
 * 待办列表外壳（PRD docs/prd/todo.md §5.1 / §6.3）。
 *
 * 参照账号库 `AccountVaultList` 的独立外壳模式：不走 `ModuleList` 的通用三布局，
 * 但仍是普通模块（路由 `/`），由 `ModuleList` 分发后挂在 Dashboard 内——
 * Dashboard 外壳由上层统一包裹，这里不再重复套壳。
 *
 * 本任务只做外壳 + 工具栏 + 快速录入；未完成区（分段 / 卡片）、已完成区、
 * 搜索与空态矩阵由后续任务接入，下面留了明确组合位。
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
              {/* 未完成区（列表日期分段 / 卡片平铺）与已完成折叠区：task6 / task7 / task9 接入 */}
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
