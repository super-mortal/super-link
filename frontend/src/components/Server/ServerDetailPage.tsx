import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Server } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ServerBasicInfoCard } from '@/components/Server/ServerBasicInfoCard.tsx';
import { ServerDeleteDialog } from '@/components/Server/ServerDeleteDialog.tsx';
import { ServerDetailHeader } from '@/components/Server/ServerDetailHeader.tsx';
import { ServerDiskSection } from '@/components/Server/ServerDiskSection.tsx';
import { ServerDockerSection } from '@/components/Server/ServerDockerSection.tsx';
import { ServerFormDialog } from '@/components/Server/ServerFormDialog.tsx';
import { ServerInstallCard } from '@/components/Server/ServerInstallCard.tsx';
import { ServerMetricsSection } from '@/components/Server/ServerMetricsSection.tsx';
import { ServerNoteCard } from '@/components/Server/ServerNoteCard.tsx';
import { ServerResetTokenDialog } from '@/components/Server/ServerResetTokenDialog.tsx';
import { ServerStatusNotice } from '@/components/Server/ServerStatusNotice.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import { SERVER_DEFAULT_RANGE } from '@/lib/serverFormat.ts';
import type { ServerDetailType, ServerMetricsSeriesType, ServerRangeType } from '@/lib/types.ts';

/** 指标快照轮询间隔（PRD §5.5「指标快照每 30 秒轮询」）；连接状态同轮刷新，断开即时反映 */
const POLL_INTERVAL_MS = 30_000;

/**
 * `/servers/:serverID` 服务器详情页（PRD §5.5，决策 D5：账号库式独立外壳、无解锁态）。
 *
 * 结构：返回行 → 头部（名称 / 分组 / 四态徽章 / 系统信息 / 开机时长与负载 / 最后回传 + 操作区）
 * → 非在线态提示条 → 图表区（task13：recharts 三图 + 范围切换）→ 两栏：磁盘区 /
 * Docker 区（task14）+ 备注卡 + 右栏基本信息 / 接入信息卡。
 *
 * 数据口径（对照 ServersDetailController 真实出参）：
 * - detail 接口只回 `server`（公开字段 + 连接状态）与 `docker`，**不含指标快照**；
 *   头部的开机时长 / 当前负载取指标序列最新点（渲染期派生，见下方 snapshot）。
 * - 轮询（30s）同时刷新 detail 与当前 range 的指标序列（task13 接管，默认 6h）；
 *   store.serverMetrics 随之被置为当前档，图表区经页面 state 消费。
 * - 磁盘数据不在 detail 出参里（后端不出），取列表项 `store.servers` 的 disks
 *   （AppSidebar 进入服务器路由时统一拉取，PRD §5.3）：磁盘是进入页面时的快照，
 *   不随 30s 轮询刷新（磁盘用量变化慢，可接受）；Docker 表格取 detail.docker，
 *   随轮询自动更新。
 */
export const ServerDetailPage = observer(() => {
  const store = useContext(StoreContext);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const serverID = Number(params.serverID);
  const validID = Number.isInteger(serverID) && serverID > 0;

  const [detail, setDetail] = useState<ServerDetailType | null>(null);
  /** 首屏加载失败 / 服务器不存在（fetchServerDetail 返回 null，store 已 toast）；轮询失败不清此态 */
  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * 当前图表范围（1h / 6h / 24h / 30d，默认 6h，PRD §5.5）。
   * 详情页无 URL 状态约定，放页面 state：切换只重拉指标（detail 不清屏），离开页面
   * 自然重置；跨服务器切换保持当前档（与原型 state.serverRange 的全局保持同语义）。
   */
  const [range, setRange] = useState<ServerRangeType>(SERVER_DEFAULT_RANGE);
  /** 当前 range 的指标序列（图表区数据源）；非在线态同样拉取——图表保留断开前的历史 */
  const [metrics, setMetrics] = useState<ServerMetricsSeriesType | null>(null);
  /**
   * 轮询偶发失败时保留旧数据、不停轮询（task12 语义）。用 ref 而非局部变量保持
   * 「曾加载成功」：range 切换会重跑轮询 effect，局部变量会把它误判为首次失败而停轮询。
   */
  const everLoadedRef = useRef(false);
  /** 列表卡片「查看接入指引 →」的滚动目标（外层 div，带锚点 id `server-install-card`） */
  const installCardRef = useRef<HTMLDivElement>(null);

  /**
   * 四个操作的挂载（task15）：编辑 / 重置 Token / 删除各自打开弹窗，暂停 / 恢复是直接
   * 动作（原型即直接切换 + 无二次确认，且不弹 toast，见 refinements §4.2）。store 侧已就绪：
   * updateServer（名称 / 备注 / 分组 / paused）、resetServerToken（旧 Token 立即失效、
   * 新明文仅此次返回）、deleteServer（级联删历史数据）。
   */
  const [editOpen, setEditOpen] = useState(false);
  /** 暂停 / 恢复无弹窗：pauseOpen 兼任「进行中」守卫，防止连点产生并发 PATCH */
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resetTokenOpen, setResetTokenOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  /**
   * 手动刷新 detail + 指标（编辑 / 暂停 / 重置 Token 写操作后）：轮询 effect 依赖本 key，
   * 变化即重跑 effect（立即重拉一次并重启 30s 轮询），不必在 effect 外再维护一份拉取逻辑。
   */
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const reloadDetail = useCallback(() => setDetailReloadKey((key) => key + 1), []);

  /**
   * 暂停 / 恢复（PRD §5.1：暂停期间不做离线判定，状态固定「已暂停」，历史数据保留）。
   * PATCH 只带 paused 一个字段——后端未传字段保持原值，不会把名称 / 分组冲掉；
   * 成功后重拉 detail：状态徽章与提示条都依赖它（列表刷新已由 store 负责）。
   */
  const handleTogglePause = async () => {
    if (!detail || pauseOpen) {
      return;
    }
    setPauseOpen(true);

    try {
      const nextPaused = !detail.server.paused;
      // silent：暂停 / 恢复的状态已由按钮文案、状态徽章与提示条三处表达，通用成功 toast 会
      // 遮挡页面头部（refinements §4.2），故跳过；失败提示不受影响
      const ok = await store.updateServer(detail.server.id, { paused: nextPaused }, { silent: true });
      // 失败保持原状：store 已按后端 message toast
      if (!ok) {
        return;
      }
      reloadDetail();
    } finally {
      setPauseOpen(false);
    }
  };

  /**
   * 备注卡内联保存（refinements §3）：PATCH 只带 note，未传字段保持原值；
   * 空串等价清空（后端 ServerPayload::optionalText 允许空串，列 NOT NULL DEFAULT ''）。
   * 成功提示由 store.updateServer 按后端 message（「服务器更新成功」）负责，这里不再
   * 重复 toast；成功后重拉详情让备注卡回到展示态。失败返回 false，卡片保留编辑态。
   */
  const handleSaveNote = async (note: string) => {
    if (!detail) {
      return false;
    }

    const ok = await store.updateServer(detail.server.id, { note });
    if (!ok) {
      return false;
    }

    reloadDetail();
    return true;
  };

  // 直接进入详情（非列表跳转）时没有历史记录，退回服务器列表
  const goBack = () => {
    if (location.key === 'default') {
      navigate('/servers');
      return;
    }
    navigate(-1);
  };

  /**
   * 头部开机时长 / 当前负载取指标序列最新点（task12 为单独 1h 拉取；task13 起指标轮询
   * 按当前 range 接管，快照统一取当前序列末点，省一半指标请求）。非在线态为 null，
   * 头部不渲染这两项（离线后 uptime / 负载失去实时意义）。
   * 取舍：30d 档末点为服务端小时聚合桶（决策 D4），开机时长呈桶内均值（粒度到天/小时，
   * 肉眼无差），负载为桶内均值——看月趋势时切回明细档即可看实时值。
   */
  const latestPoint = metrics && metrics.points.length > 0 ? metrics.points[metrics.points.length - 1] : null;
  const snapshot = detail?.server.status === 'online' ? latestPoint : null;

  /**
   * 磁盘区数据来源（task14）：detail 接口出参只有 server + docker，不含磁盘
   * （对照 ServersDetailController），磁盘取侧栏进入服务器路由时统一拉取的列表项
   * disks（AppSidebar 的 fetchServers，PRD §5.3）。因此磁盘是进入页面时的快照，
   * 不随 30s 轮询刷新——磁盘用量按 GB 级慢速变化，可接受。已知边界：若侧栏分组
   * 筛选把当前服务器排除在列表结果外（如带筛选直改 URL 进入的极端场景），
   * 这里会取到空数组、磁盘区显示空态；重新进入列表即可恢复。
   */
  const disks = store.servers.find((item) => item.id === serverID)?.disks ?? [];

  // 切换服务器（/servers/1 → /servers/2）先清掉上一台的数据，避免头部 / 图表闪现旧内容。
  // 单独一个 effect：轮询 effect 还依赖 range，若把清屏合并在里面，切换 range 会连带
  // 清掉 detail、触发整页加载骨架
  useEffect(() => {
    if (!validID) {
      return;
    }
    setDetail(null);
    setMetrics(null);
    setLoadFailed(false);
    everLoadedRef.current = false;
  }, [validID, serverID]);

  useEffect(() => {
    if (!validID) {
      return;
    }

    // 卸载 / 切换 / 切 range 时置位：丢弃在途响应，避免旧服务器的数据写进新页面
    let cancelled = false;
    let timer = 0;

    const loadDetail = async () => {
      const result = await store.fetchServerDetail(serverID);
      if (cancelled) {
        return;
      }
      if (result === null) {
        if (!everLoadedRef.current) {
          setLoadFailed(true);
          // 首屏就没拿到（含服务器已不存在的 404）：停掉轮询——store 的 GET 失败会
          // toast，否则对已删除的服务器每 30s 弹一次错误提示；重新进入列表点开即可重试
          window.clearInterval(timer);
        }
        return;
      }
      everLoadedRef.current = true;
      setDetail(result);
      setLoadFailed(false);

      // task13 接管（task12 占位注释约定）：指标序列按当前 range 拉取，store.serverMetrics
      // 随之变为当前档，图表区消费本 state。非在线态也拉——离线机器的图表保留断开前
      // 历史（原型 offline 态不停图表），pending 从未回传返回空序列、图表区走空态。
      // 拉取失败（null）保留上一份序列不清屏：与 detail 轮询同样「偶发失败不停摆」
      const series = await store.fetchServerMetrics(serverID, range);
      if (cancelled || series === null) {
        return;
      }
      setMetrics(series);
    };

    void loadDetail();

    // 四态都轮询、不按状态门控：online ↔ offline ↔ pending 互转需要及时反映
    // （如 agent 重连、暂停被恢复），暂停态机器同样如此；个人级请求量可忽略。
    // range 变化会重跑本 effect：立即按新档重拉一次并重启 30s 轮询
    timer = window.setInterval(() => void loadDetail(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // detailReloadKey 变化 = 写操作后手动刷新：立即重拉一次并重启轮询
  }, [store, serverID, validID, range, detailReloadKey]);

  /**
   * 列表卡片「查看接入指引 →」跳转（refinements §4.1）：路由 state 标记 focusInstall，
   * 详情首次落地后（effect 在提交后执行，此时布局已完成）把接入信息卡滚进视口；
   * 随即 replace 清掉 state，避免 30s 轮询重渲染或再次进入时重复滚动。
   */
  useEffect(() => {
    if (!detail) {
      return;
    }
    if (!(location.state as { focusInstall?: boolean } | null)?.focusInstall) {
      return;
    }

    installCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    navigate(location.pathname, { replace: true, state: null });
  }, [detail, location.pathname, location.state, navigate]);

  const backButton = (
    <div className="flex items-center gap-2">
      <SidebarToggler />
      <button
        type="button"
        onClick={goBack}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[13px] transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        返回服务器列表
      </button>
    </div>
  );

  // 首屏加载态：头部 + 信息卡骨架（不引 Loading 全页骨架——那会再套一层侧栏 skeleton）
  const loadingSkeleton = (
    <div className="flex flex-col gap-4">
      <div className="bg-card flex items-center gap-4 rounded-xl border p-5">
        <Skeleton className="size-12 rounded-lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-72" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-xl lg:col-span-2" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    </div>
  );

  const notFoundCard = (invalid: boolean) => (
    <Card className="max-w-md">
      <CardContent className="flex flex-col items-center gap-4 py-10">
        <Server className="text-muted-foreground size-10" aria-hidden="true" />
        <p className="text-muted-foreground text-sm">{invalid ? '服务器 ID 无效' : '服务器不存在或加载失败'}</p>
        <Button variant="outline" onClick={goBack}>
          <ArrowLeft />
          返回服务器列表
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <Dashboard>
      <div className="no-scrollbar h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-5">
          {backButton}

          {!validID ? (
            notFoundCard(true)
          ) : loadFailed ? (
            notFoundCard(false)
          ) : !detail ? (
            loadingSkeleton
          ) : (
            <>
              <ServerDetailHeader
                server={detail.server}
                snapshot={snapshot}
                onEdit={() => setEditOpen(true)}
                onTogglePause={() => void handleTogglePause()}
                onResetToken={() => setResetTokenOpen(true)}
                onDelete={() => setDeleteOpen(true)}
              />

              <ServerStatusNotice status={detail.server.status} lastReportAt={detail.server.last_report_at} />

              {/* 图表区（task13，PRD §5.5 / 决策 D9）：recharts 三图 + 范围切换；
                  range 状态与轮询接管见上方 effect 与文件头注释 */}
              <ServerMetricsSection
                series={metrics}
                loading={store.serverMetricsLoading}
                range={range}
                onRangeChange={setRange}
                status={detail.server.status}
              />

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="flex flex-col gap-4 lg:col-span-2">
                  {/* 磁盘区（task14，PRD §5.5）：各挂载点用量条，≥80% 警示 / ≥90% 危险；
                      数据来源见上方 disks 注释（列表项快照，不随轮询刷新） */}
                  <ServerDiskSection disks={disks} />

                  {/* Docker 区（task14，PRD §5.3 / §5.5）：容器表格（名称 / 状态 / CPU / 内存 /
                      网络）；detail.docker 随 30s 轮询自动刷新，空态二分见组件注释 */}
                  <ServerDockerSection containers={detail.docker} hasReported={detail.server.last_report_at !== null} />

                  {/* 备注卡（refinements §3）：常驻，空态给「添加」、有备注给「编辑」；
                      内联保存走 handleSaveNote（updateServer({ note }) + 重拉详情） */}
                  <ServerNoteCard note={detail.server.note} onSave={handleSaveNote} />
                </div>

                <div className="flex flex-col gap-4">
                  <ServerBasicInfoCard server={detail.server} hubVersion={store.appInfo?.installed_version ?? null} />
                  {/* 接入信息卡：外层 div 提供滚动锚点（列表卡片「查看接入指引 →」跳转目标，
                      refinements §4.1）；scroll-mt 避免滚动后卡片顶边贴死容器 */}
                  <div ref={installCardRef} id="server-install-card" className="scroll-mt-4">
                    <ServerInstallCard />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 编辑弹窗（名称 / 备注 / 分组，原型暂未覆盖由本任务补齐）：保存成功后重拉详情 */}
      <ServerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        server={detail?.server ?? null}
        onSaved={reloadDetail}
      />
      {/* 暂停 / 恢复为直接动作（见 handleTogglePause），无弹窗挂载 */}
      {/* 重置 Token 弹窗：二次确认 → 新 Token 明文与安装命令一次性展示（与添加弹窗共用 ServerTokenGuide） */}
      <ServerResetTokenDialog
        open={resetTokenOpen}
        onOpenChange={setResetTokenOpen}
        server={detail?.server ?? null}
        onCompleted={reloadDetail}
      />
      {/* 删除确认弹窗：历史数据级联删除，确认后跳回列表（store 已负责刷新列表） */}
      <ServerDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        server={detail?.server ?? null}
        onDeleted={() => navigate('/servers')}
      />
    </Dashboard>
  );
});
