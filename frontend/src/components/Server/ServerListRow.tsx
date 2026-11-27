import type { KeyboardEvent } from 'react';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { formatServerLastReport, formatServerPercent } from '@/lib/serverFormat.ts';
import { UsageMeter, diskPct, meterTone, type MeterTone } from '@/components/Server/UsageMeter.tsx';
import { ServerStatusBadge } from '@/components/Server/ServerStatusBadge.tsx';
import type { ServerItemType } from '@/lib/types.ts';

type ListMetricProps = {
  label: string;
  /** null = 无快照或数据缺失：展示「—」而非 0%（与原型 serverListRowHtml 同口径） */
  pct: number | null;
  tone: MeterTone;
  /** 磁盘指标附带类：窄屏隐藏等响应式控制在调用方 */
  className?: string;
  title?: string;
};

/** 列表视图指标：标签 + 数值 + 细条（细条复用共享 UsageMeter，禁止另写阈值 / 配色） */
const ListMetric = ({ label, pct, tone, className, title }: ListMetricProps) => (
  <span
    className={cn('text-muted-foreground inline-flex w-32 items-center gap-1.5 text-xs whitespace-nowrap', className)}
    title={title}
  >
    <span className="shrink-0">{label}</span>
    <b className="text-foreground w-9 shrink-0 text-right text-xs font-medium tabular-nums">
      {pct === null ? '—' : formatServerPercent(pct)}
    </b>
    <UsageMeter pct={pct ?? 0} tone={tone} className="h-1.5 min-w-6 flex-1" />
  </span>
);

type ServerListRowProps = {
  server: ServerItemType;
  onOpen: (id: number) => void;
};

/**
 * 服务器列表视图单行（PRD §5.1 / §5.5，决策 D13，原型 serverListRowHtml）。
 *
 * 信息层级：状态徽章 → 名称 + 分组 → 系统信息 → CPU / 内存 / 磁盘 → 最近上报。
 * 容错口径与卡片一致（ServerCard）：不能只按 status 判断是否有指标——暂停一台从未
 * 连接的机器 status 为 paused 但 latest 是 null，直接取值会崩；统一按「有快照」门控。
 * 无快照 / 非在线时细条走 mute 灰、未知数值显示「—」。
 *
 * 窄屏逐级降级（Tailwind 响应式类）：<1100px 隐藏磁盘，<860px 隐藏整组指标且状态列
 * 自适应宽度，<640px 隐藏最近上报时间。
 */
export const ServerListRow = ({ server, onOpen }: ServerListRowProps) => {
  const live = server.status === 'online';
  // 暂停 / 等待连接整行置灰（与卡片 dim 口径一致）；离线保留指标但降为 mute
  const dimmed = server.status === 'paused' || server.status === 'pending';
  const snapshot = server.latest;

  // 磁盘取用量最大的挂载点（与卡片同口径），悬停 title 列出全部分区
  const disks = server.disks ?? [];
  const topDisk = disks.length > 0 ? disks.reduce((top, disk) => (diskPct(disk) > diskPct(top) ? disk : top)) : null;
  const diskTitle = disks.map((disk) => `${disk.mount} ${Math.round(diskPct(disk))}%`).join(' · ');

  const cpuPct = snapshot ? snapshot.cpu : null;
  const memPct = snapshot && snapshot.mem_total > 0 ? (snapshot.mem_used / snapshot.mem_total) * 100 : null;
  const topDiskPct = snapshot && topDisk ? diskPct(topDisk) : null;

  // 在线才按阈值上色（磁盘 80 / 90），其余一律 mute 灰；未知值无阈值可言
  const toneOf = (pct: number | null, warn?: number, crit?: number): MeterTone =>
    live && pct !== null ? meterTone(pct, warn, crit) : 'mute';

  const systemInfo = server.os_name
    ? `${server.os_name}${server.cpu_cores ? ` · ${server.cpu_cores} 核` : ''}${
        server.ip_address && server.ip_address !== '—' ? ` · ${server.ip_address}` : ''
      }`
    : '';

  // 最近上报：在线显示相对时间，离线 / 暂停 / 未连接用状态短文案（原型同款，窄列更稳定）
  const reportText = live
    ? formatServerLastReport(server.last_report_at)
    : server.status === 'offline'
      ? '已断开'
      : server.status === 'paused'
        ? '已暂停'
        : '未连接';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(server.id)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(server.id);
        }
      }}
      className={cn(
        'hover:bg-muted/40 flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0',
        dimmed && 'opacity-55'
      )}
    >
      <span className="shrink-0 min-[860px]:w-[5.5rem]">
        <ServerStatusBadge status={server.status} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4 className="truncate text-sm font-semibold">{server.name}</h4>
          {server.group ? (
            <span className="bg-secondary text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] leading-5">
              <Folder className="size-3 shrink-0" aria-hidden="true" />
              <span className="max-w-28 truncate">{server.group}</span>
            </span>
          ) : null}
        </div>
        {systemInfo ? <div className="text-muted-foreground truncate text-xs">{systemInfo}</div> : null}
      </div>

      {/* 指标组：<860px 整组隐藏，状态列此时宽度自适应 */}
      <div className="hidden shrink-0 items-center gap-3.5 min-[860px]:flex">
        <ListMetric label="CPU" pct={cpuPct} tone={toneOf(cpuPct)} />
        <ListMetric label="内存" pct={memPct} tone={toneOf(memPct)} />
        <ListMetric
          label="磁盘"
          pct={topDiskPct}
          tone={toneOf(topDiskPct, 80, 90)}
          className="max-[1099px]:hidden"
          title={diskTitle}
        />
      </div>

      <span
        className="text-muted-foreground hidden shrink-0 text-right text-xs tabular-nums sm:block sm:w-[4.5rem]"
        title={server.last_report_at ?? undefined}
      >
        {reportText}
      </span>
    </div>
  );
};
