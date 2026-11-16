import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { ServerCard } from '@/components/Server/ServerCard.tsx';
import { ServerEmptyState } from '@/components/Server/ServerEmptyState.tsx';
import { ServerToolbar } from '@/components/Server/ServerToolbar.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import { SERVER_GROUPS, SERVER_SORTS, parseServerSort } from '@/lib/serverFormat.ts';

/**
 * `/servers` 服务器列表页（PRD §5.1 / §5.5，决策 D5）。
 *
 * 独立路由 + 自建列表外壳（不过 ModuleList 通用三布局，监控卡片需要更大展示空间；
 * 无解锁态——服务器模块没有敏感凭据）。
 *
 * 数据加载：task10 起由 AppSidebar 在进入 `/servers` 路由时统一拉取一次
 * （侧栏分组计数与列表同源，见 AppSidebar 的 useEffect），本页**不重复请求**，
 * 只在本轮拉取落地前展示骨架，避免空列表闪烁出空态引导。
 *
 * 筛选口径（与账号库一致，后端返回全量、前端过滤）：
 * - 分组：侧栏点选即下推后端（store.serverListParams.group），store.servers 已是过滤结果；
 * - 搜索 / 排序：在本地全量数据上即时完成（store.filterServers），输入不必每敲一个字都发请求。
 */
export const ServerListPage = observer(() => {
  const store = React.useContext(StoreContext);
  const navigate = useNavigate();

  const [search, setSearch] = React.useState('');
  // 缺省「状态（在线优先）」：与后端 parseSort 的缺省方向一致
  const [sortKey, setSortKey] = React.useState(SERVER_SORTS[0].value);
  /**
   * 添加服务器弹窗挂载点：完整弹窗（名称 / 备注 / 分组 + Token 与安装命令一次性展示）属 task15，
   * store.createServer 已就绪（task9）。本任务只置位 state，不渲染弹窗本体。
   */
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);

  // 首屏加载态：等 AppSidebar 本轮拉取落地（serversLoading 由 true 转 false）；
  // 再次进入路由时 store 里已有数据，首帧即可直接展示
  const [initialLoaded, setInitialLoaded] = React.useState(store.servers.length > 0);
  React.useEffect(() => {
    if (!initialLoaded && !store.serversLoading) {
      setInitialLoaded(true);
    }
  }, [initialLoaded, store.serversLoading]);

  const { sort, order } = parseServerSort(sortKey);
  // store.servers / store.serverListParams 均为 observable，observer 渲染时自动追踪：
  // 分组（侧栏下推后端）/ 搜索 / 排序任一变化即重算，无需手动维护依赖数组
  const servers = store.filterServers({ ...store.serverListParams, search: search.trim(), sort, order });

  // 空态三分（与账号库空态优先级同思路）：本身为空 > 搜索无结果 > 分组筛选为空。
  // 「一台都没有」不能靠 store.servers 判断（它已是分组过滤结果），改用侧栏分组计数：
  // 后端恒定返回四项，四项全 0 才是真的没有服务器
  const noServersAtAll = SERVER_GROUPS.every((group) => (store.serverGroups[group] ?? 0) === 0);
  const emptyVariant = noServersAtAll ? 'empty' : search.trim() ? 'search' : 'group';

  const openServerDetail = (id: number) => navigate(`/servers/${id}`);

  const toolbar = (
    <ServerToolbar
      search={search}
      onSearchChange={setSearch}
      sortKey={sortKey}
      onSortChange={setSortKey}
      onAdd={() => setAddDialogOpen(true)}
    />
  );

  if (!initialLoaded) {
    return (
      <Dashboard>
        <div className="flex h-full flex-col">
          {toolbar}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="min-h-[18.5rem] rounded-lg" />
            ))}
          </div>
        </div>
      </Dashboard>
    );
  }

  return (
    <Dashboard>
      <div className="flex h-full flex-col">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {servers.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4 p-4">
              {servers.map((server) => (
                <ServerCard key={server.id} server={server} onOpen={openServerDetail} />
              ))}
            </div>
          ) : (
            <ServerEmptyState
              variant={emptyVariant}
              onAdd={() => setAddDialogOpen(true)}
              onClearSearch={() => setSearch('')}
              onClearGroup={() => void store.fetchServers({ ...store.serverListParams, group: null })}
            />
          )}
        </div>
      </div>
      {/* task15 接线点：添加弹窗挂载处（open={addDialogOpen} onOpenChange={setAddDialogOpen}），
          store.createServer 已就绪；本任务仅置位 state，不渲染弹窗本体 */}
      {addDialogOpen && null}
    </Dashboard>
  );
});
