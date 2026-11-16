import { AlertTriangle, Clock, Pause } from 'lucide-react';
import type { ServerStatusType } from '@/lib/types.ts';

type ServerStatusNoticeProps = {
  status: ServerStatusType;
  /** 离线提示里「数据停留时间」取最后回传绝对时间（从未回传应为 null，理论上离线态必有值） */
  lastReportAt: string | null;
};

/**
 * 非在线态提示条（原型 .srv-alert，PRD §5.5）：在线态不渲染任何提示条。
 * - 离线：琥珀告警条，说明长连接已断开、数据停留时间与排查命令；
 * - 已暂停 / 等待连接：中性说明条（muted 底），分别解释暂停语义与首次连接引导。
 * 配色沿用账号库「待处理」徽章的琥珀色系写法（border/bg/text 均带 dark: 变体）。
 */
export const ServerStatusNotice = ({ status, lastReportAt }: ServerStatusNoticeProps) => {
  if (status === 'online') {
    return null;
  }

  if (status === 'offline') {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3.5 text-[13px]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <div>
          <b className="mb-0.5 block font-medium">连接已断开</b>
          <span className="text-muted-foreground">
            Agent 与 Hub 的长连接已断开，图表数据停留在 {lastReportAt ?? '—'}
            。请检查被监控机的网络与 link-agent 服务状态（systemctl status link-agent）。
          </span>
        </div>
      </div>
    );
  }

  const paused = status === 'paused';
  const Icon = paused ? Pause : Clock;

  return (
    <div className="bg-muted flex items-start gap-2.5 rounded-lg border px-4 py-3.5 text-[13px]">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        <b className="mb-0.5 block font-medium">{paused ? '监控已暂停' : '等待首次连接'}</b>
        <span className="text-muted-foreground">
          {paused
            ? '暂停期间不做离线判定，历史数据保留。'
            : 'Agent 安装并启动后会主动连接 Hub 并保持，稍后刷新即可看到数据。'}
        </span>
      </div>
    </div>
  );
};
