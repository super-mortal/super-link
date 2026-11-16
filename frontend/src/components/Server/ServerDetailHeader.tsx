import { Clock, Pause, Pencil, Play, RotateCw, Server, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { ServerStatusBadge } from '@/components/Server/ServerStatusBadge.tsx';
import { formatServerLastReport, formatServerUptime } from '@/lib/serverFormat.ts';
import type { ServerMetricsPointType, ServerWithStatusType } from '@/lib/types.ts';

type ServerDetailHeaderProps = {
  server: ServerWithStatusType;
  /**
   * 开机时长 / 当前负载的数据源：detail 接口不含指标快照（ServersDetailController 只回
   * server + docker），由页面拉取 1h 指标序列后取最新点传入；非在线态或未回传时为 null，
   * 头部不渲染这两项（PRD §5.5「在线时展示」）。
   */
  snapshot: ServerMetricsPointType | null;
  /** 四个操作目前只置位页面 state：弹窗 / 写操作本体属 task15 接线（store 方法已就绪） */
  onEdit: () => void;
  onTogglePause: () => void;
  onResetToken: () => void;
  onDelete: () => void;
};

/** 系统信息行：发行版 · CPU 核数 · IP（在线时附开机时长），原型 acc-detail-id 第一行 */
const ServerSystemLine = ({
  server,
  snapshot,
}: {
  server: ServerWithStatusType;
  snapshot: ServerMetricsPointType | null;
}) => (
  <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
    <span className="break-all">{server.os_name}</span>
    <span aria-hidden="true">·</span>
    <span>{server.cpu_cores ? `${server.cpu_cores} 核` : '—'}</span>
    <span aria-hidden="true">·</span>
    <span className="font-mono break-all">{server.ip_address}</span>
    {snapshot ? (
      <>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <Clock className="size-3.5" aria-hidden="true" />
          运行 {formatServerUptime(snapshot.uptime)}
        </span>
      </>
    ) : null}
  </p>
);

/**
 * 详情页头部（PRD §5.5，原型 detail-headcard / acc-detail-head）：
 * 头像 + 名称 + 分组徽章 + 四态状态徽章；两行元信息（系统信息 / 负载与最后回传）；
 * 右侧操作区（编辑 / 暂停恢复 / 重置 Token / 删除）。
 * <640px 操作按钮只留图标（原型 .detail-actions .acc-btn-label 的隐藏断点）。
 */
export const ServerDetailHeader = ({
  server,
  snapshot,
  onEdit,
  onTogglePause,
  onResetToken,
  onDelete,
}: ServerDetailHeaderProps) => {
  const online = server.status === 'online';
  const paused = server.paused;

  return (
    <div className="bg-card flex flex-wrap items-start justify-between gap-4 rounded-xl border p-5">
      <div className="flex min-w-0 items-start gap-3.5">
        <div className="bg-secondary flex size-12 shrink-0 items-center justify-center rounded-lg">
          <Server className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold break-all">{server.name}</h1>
            {server.group ? (
              <span className="text-muted-foreground shrink-0 rounded border px-1.5 text-[11px]">{server.group}</span>
            ) : null}
            <ServerStatusBadge status={server.status} size="lg" />
          </div>

          <ServerSystemLine server={server} snapshot={snapshot} />

          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            {online && snapshot ? (
              <>
                <span className="tabular-nums">
                  负载 {snapshot.load1.toFixed(2)} / {snapshot.load5.toFixed(2)} / {snapshot.load15.toFixed(2)}
                </span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>
              最后回传{' '}
              {server.last_report_at
                ? `${server.last_report_at}（${formatServerLastReport(server.last_report_at)}）`
                : '尚未回传'}
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil />
          <span className="hidden sm:inline">编辑</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onTogglePause}>
          {paused ? <Play /> : <Pause />}
          <span className="hidden sm:inline">{paused ? '恢复监控' : '暂停监控'}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onResetToken}>
          <RotateCw />
          <span className="hidden sm:inline">重置 Token</span>
        </Button>
        {/* 删除用描边 +  destructive 文字色（与账号库详情头部同款，不用实心红，避免头部过重） */}
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 />
          <span className="hidden sm:inline">删除</span>
        </Button>
      </div>
    </div>
  );
};
