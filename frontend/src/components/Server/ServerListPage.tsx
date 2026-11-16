import { observer } from 'mobx-react-lite';
import { ServerCog } from 'lucide-react';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';

/**
 * `/servers` 服务器列表页占位（PRD §5.5，决策 D5）。
 *
 * 服务器是独立路由 + 自建列表外壳（不走 ModuleList 通用三布局，图表需要更大展示空间），
 * task11 会替换为真实卡片列表（beszel SystemCard 同款结构 + 搜索 / 排序工具栏 + 空态引导）。
 *
 * 当前只保证路由可达的最小形态：标题 + 开发中提示 + 工具栏骨架。
 * 列表数据与侧栏分组计数由 AppSidebar 进入路由时统一拉取（store.servers / store.serverGroups），
 * 本页不自行请求，避免与后续 task11 的加载逻辑重复。
 */
export const ServerListPage = observer(() => {
  return (
    <Dashboard>
      <div className="flex h-full flex-col">
        {/* 工具栏骨架：task11 替换为 侧栏开关 + 搜索 / 排序 + 添加服务器 真实控件 */}
        <header className="bg-background sticky top-0 z-50 flex h-14 w-full items-center gap-1.5 border-b px-4">
          <SidebarToggler />
          <ServerCog className="h-4 w-4" />
          <span className="text-sm font-medium">服务器</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Skeleton className="hidden h-8 w-24 @xl/main:block" />
            <Skeleton className="hidden h-8 w-20 @xl/main:block" />
            <Skeleton className="h-8 w-24" />
          </div>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10">
          <ServerCog className="text-muted-foreground h-10 w-10" />
          <p className="text-base font-medium">服务器</p>
          <p className="text-muted-foreground text-sm">列表开发中（task11 填充）</p>
        </div>
      </div>
    </Dashboard>
  );
});
