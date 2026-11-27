import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { SidebarSection } from '@/components/Sidebar/SidebarSection.tsx';
import { SidebarFilterRow } from '@/components/Sidebar/SidebarFilterRow.tsx';
import { SidebarMenu } from '@/components/ui/sidebar.tsx';
import { StoreContext } from '@/store/storeContext.ts';

/**
 * 待办侧栏概览（PRD §5.1 / T11）：两行「未完成 N」「已完成 N」，点击筛选、再点取消。
 *
 * 计数与主区域同源（都来自 store.todos），筛选值存 store.todoFilter——切模块时由
 * store.setModule 一并重置，保证列表与侧栏不会出现「侧栏高亮但列表已换模块」的错位。
 * 外壳与行规格复用 SidebarSection / SidebarFilterRow，与其他分区保持同一套几何与高亮样式。
 */
export const TodoOverview = observer(() => {
  const store = React.useContext(StoreContext);

  const openCount = store.todos.filter((todo) => !todo.done).length;
  const doneCount = store.todos.length - openCount;

  // 再点当前项即取消筛选（回到默认视图），与账号库平台 / 服务器分组筛选同款交互
  const toggleFilter = (next: 'open' | 'done') => {
    store.todoFilter = store.todoFilter === next ? null : next;
  };

  return (
    <SidebarSection label="概览">
      <SidebarMenu>
        <SidebarFilterRow
          label="未完成"
          count={openCount}
          isActive={store.todoFilter === 'open'}
          onClick={() => toggleFilter('open')}
        />
        <SidebarFilterRow
          label="已完成"
          count={doneCount}
          isActive={store.todoFilter === 'done'}
          onClick={() => toggleFilter('done')}
        />
      </SidebarMenu>
    </SidebarSection>
  );
});
