import { useContext, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Container, HardDrive, ServerCog } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ServerBasicInfoCard } from '@/components/Server/ServerBasicInfoCard.tsx';
import { ServerDetailHeader } from '@/components/Server/ServerDetailHeader.tsx';
import { ServerInstallCard } from '@/components/Server/ServerInstallCard.tsx';
import { ServerMetricsSection } from '@/components/Server/ServerMetricsSection.tsx';
import { ServerNoteCard } from '@/components/Server/ServerNoteCard.tsx';
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
 * → 非在线态提示条 → 图表区（task13：recharts 三图 + 范围切换）→ 两栏：磁盘 / Docker
 * 占位（task14）+ 备注卡 + 右栏基本信息 / 接入信息卡。
 *
 * 数据口径（对照 ServersDetailController 真实出参）：
 * - detail 接口只回 `server`（公开字段 + 连接状态）与 `docker`，**不含指标快照**；
 *   头部的开机时长 / 当前负载取指标序列最新点（渲染期派生，见下方 snapshot）。
 * - 轮询（30s）同时刷新 detail 与当前 range 的指标序列（task13 接管，默认 6h）；
 *   store.serverMetrics 随之被置为当前档，图表区经页面 state 消费。
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

  /**
   * task15 接线点：四个操作只置位页面 state（弹窗 / 写操作本体属 task15）。
   * store 侧已就绪：updateServer（名称 / 备注 / 分组 / paused）、resetServerToken
   * （旧 Token 立即失效、新明文仅此次返回）、deleteServer（级联删历史数据）。
   * 与 task11 添加按钮同款处理：不挂死逻辑、不放「开发中」toast。
   */
  const [editOpen, setEditOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resetTokenOpen, setResetTokenOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  }, [store, serverID, validID, range]);

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
        <ServerCog className="text-muted-foreground size-10" aria-hidden="true" />
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
      <div className="h-full overflow-y-auto">
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
                onTogglePause={() => setPauseOpen(true)}
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
                  {/* 磁盘区占位（task14）：分区外壳，各挂载点用量条（超 80% 警示 / 90% 危险）由 task14 填充 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <HardDrive className="text-muted-foreground size-4" aria-hidden="true" />
                        磁盘
                      </CardTitle>
                    </CardHeader>
                    <CardContent>{/* task14 填充：磁盘用量条列表 */}</CardContent>
                  </Card>

                  {/* Docker 区占位（task14）：分区外壳，容器表格（名称 / 状态 / CPU / 内存 / 网络）
                      由 task14 基于 detail.docker 填充（Docker 不可用时展示空态） */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Container className="text-muted-foreground size-4" aria-hidden="true" />
                        Docker 容器
                      </CardTitle>
                    </CardHeader>
                    <CardContent>{/* task14 填充：容器表格 */}</CardContent>
                  </Card>

                  <ServerNoteCard note={detail.server.note} />
                </div>

                <div className="flex flex-col gap-4">
                  <ServerBasicInfoCard server={detail.server} hubVersion={store.appInfo?.installed_version ?? null} />
                  <ServerInstallCard />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* task15 接线点：编辑弹窗（名称 / 备注 / 分组，原型暂未覆盖需补齐）挂载处，store.updateServer 已就绪 */}
      {editOpen && null}
      {/* task15 接线点：暂停 / 恢复动作挂载处（store.updateServer({ paused }) + 重拉详情；原型为直接切换 + toast） */}
      {pauseOpen && null}
      {/* task15 接线点：重置 Token 弹窗挂载处（二次确认 + 一次性明文 Token 与安装命令，store.resetServerToken 已就绪） */}
      {resetTokenOpen && null}
      {/* task15 接线点：删除确认弹窗挂载处（历史数据级联删除，store.deleteServer 已就绪） */}
      {deleteOpen && null}
    </Dashboard>
  );
});
