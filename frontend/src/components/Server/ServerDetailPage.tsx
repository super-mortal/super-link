import { observer } from 'mobx-react-lite';
import { useParams } from 'react-router-dom';
import { ServerCog } from 'lucide-react';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';

/**
 * `/servers/:serverID` 服务器详情页占位（PRD §5.5，决策 D5）。
 *
 * task12 会替换为真实详情页（头部 / recharts 图表区 / 磁盘 / Docker / 接入信息卡 / 操作）。
 * 当前只保证路由可达：解析 serverID 参数给出提示，详情开发中 + 工具栏骨架；
 * 不请求详情接口（task11/task12 的加载逻辑会一并补齐，避免占位期重复请求）。
 */
export const ServerDetailPage = observer(() => {
  const params = useParams();
  const serverID = Number(params.serverID);
  const validID = Number.isInteger(serverID) && serverID > 0;

  return (
    <Dashboard>
      <div className="flex h-full flex-col">
        {/* 工具栏骨架：task12 替换为 侧栏开关 + 编辑 / 暂停 / 重置 Token / 删除 真实控件 */}
        <header className="bg-background sticky top-0 z-50 flex h-14 w-full items-center gap-1.5 border-b px-4">
          <SidebarToggler />
          <ServerCog className="h-4 w-4" />
          <span className="text-sm font-medium">服务器详情</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Skeleton className="hidden h-8 w-16 @xl/main:block" />
            <Skeleton className="h-8 w-16" />
          </div>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10">
          <ServerCog className="text-muted-foreground h-10 w-10" />
          <p className="text-base font-medium">服务器详情</p>
          <p className="text-muted-foreground text-sm">
            {validID ? `服务器 #${serverID} 详情开发中（task12 填充）` : '服务器 ID 无效'}
          </p>
        </div>
      </div>
    </Dashboard>
  );
});
