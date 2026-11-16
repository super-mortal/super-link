import { useContext, useEffect, useState } from 'react';
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
import { ServerNoteCard } from '@/components/Server/ServerNoteCard.tsx';
import { ServerStatusNotice } from '@/components/Server/ServerStatusNotice.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import type { ServerDetailType, ServerMetricsPointType } from '@/lib/types.ts';

/** 指标快照轮询间隔（PRD §5.5「指标快照每 30 秒轮询」）；连接状态同轮刷新，断开即时反映 */
const POLL_INTERVAL_MS = 30_000;

/**
 * `/servers/:serverID` 服务器详情页（PRD §5.5，决策 D5：账号库式独立外壳、无解锁态）。
 *
 * 结构：返回行 → 头部（名称 / 分组 / 四态徽章 / 系统信息 / 开机时长与负载 / 最后回传 + 操作区）
 * → 非在线态提示条 → 图表区占位（task13）→ 两栏：磁盘 / Docker 占位（task14）+ 备注卡 +
 * 右栏基本信息 / 接入信息卡。
 *
 * 数据口径（对照 ServersDetailController 真实出参）：
 * - detail 接口只回 `server`（公开字段 + 连接状态）与 `docker`，**不含指标快照**；
 *   头部的开机时长 / 当前负载改取指标序列（1h 档）最新点，落在页面内存 state。
 * - 轮询同时刷新 detail 与 1h 快照；store.serverMetrics 随之被置为 1h 档，
 *   task13 图表区落地后由其按当前 range 接管该字段与轮询参数。
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
  /** 头部开机时长 / 当前负载（指标序列最新点）；非在线态为 null，对应项不渲染 */
  const [snapshot, setSnapshot] = useState<ServerMetricsPointType | null>(null);

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

  useEffect(() => {
    if (!validID) {
      return;
    }

    // 切换服务器（/servers/1 → /servers/2）先清掉上一台的数据与快照，避免头部闪现旧内容
    setDetail(null);
    setSnapshot(null);
    setLoadFailed(false);

    // 卸载 / 切换时置位：丢弃在途响应，避免旧服务器的数据写进新页面
    let cancelled = false;
    // 本轮（当前 serverID）是否已拿到过数据：轮询偶发失败时保留旧数据不清屏、不停轮询
    let everLoaded = false;
    let timer = 0;

    const loadDetail = async () => {
      const result = await store.fetchServerDetail(serverID);
      if (cancelled) {
        return;
      }
      if (result === null) {
        if (!everLoaded) {
          setLoadFailed(true);
          // 首屏就没拿到（含服务器已不存在的 404）：停掉轮询——store 的 GET 失败会
          // toast，否则对已删除的服务器每 30s 弹一次错误提示；重新进入列表点开即可重试
          window.clearInterval(timer);
        }
        return;
      }
      everLoaded = true;
      setDetail(result);
      setLoadFailed(false);

      // 开机时长 / 负载仅在线态展示：非在线态不拉指标（pending 从未回传更没有数据），
      // 并清掉上一轮快照，避免机器离线后头部仍显示离线前的负载
      if (result.server.status !== 'online') {
        setSnapshot(null);
        return;
      }

      const series = await store.fetchServerMetrics(serverID, '1h');
      if (cancelled) {
        return;
      }
      // 序列按 received_at 升序（后端保证），最后一点即最新快照
      const points = series?.points ?? [];
      setSnapshot(points.length > 0 ? points[points.length - 1] : null);
    };

    void loadDetail();

    // 四态都轮询、不按状态门控：online ↔ offline ↔ pending 互转需要及时反映
    // （如 agent 重连、暂停被恢复），暂停态机器同样如此；个人级请求量可忽略
    timer = window.setInterval(() => void loadDetail(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [store, serverID, validID]);

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

              {/* 图表区占位（task13）：只建分区外壳——标题 + 范围切换挂载点 + 图表卡容器，
                  recharts 三图（CPU / 内存 / 网络，默认 6 小时）由 task13 填充，
                  届时按「有历史数据」门控整区渲染、范围切换改走 store.serverMetrics */}
              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[13px] font-medium">历史趋势</h2>
                  {/* task13 接线点：范围切换（1 小时 / 6 小时 / 24 小时 / 30 天，SERVER_RANGES）挂载处 */}
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{/* task13 填充：三张图表卡 */}</div>
              </section>

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
