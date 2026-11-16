import { observer } from 'mobx-react-lite';
import type { KeyboardEvent, ReactNode } from 'react';
import { Clock, Container, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { SERVER_STATUS, formatServerLastReport, formatServerRate, formatServerUptime } from '@/lib/serverFormat.ts';
import type { ServerItemType } from '@/lib/types.ts';

/** meter 细条配色档位（原型 bar > i 的 ok / warn / err / mute，见 mockups/styles.css） */
type MeterTone = 'ok' | 'warn' | 'err' | 'mute';

const METER_TONE_CLASS: Record<MeterTone, string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-500',
  err: 'bg-destructive',
  // 离线卡片整体置灰时用：细条变灰但不消失，保持三列结构稳定
  mute: 'bg-muted-foreground/45',
};

/**
 * meter 阈值配色（beszel colorWarn / colorCrit 同款，PRD §5.1）：
 * CPU / 内存按 65 黄 / 90 红；磁盘按 80 黄 / 90 红——磁盘用量涨得慢，阈值放宽一档。
 */
const meterTone = (pct: number, warn = 65, crit = 90): MeterTone => (pct >= crit ? 'err' : pct >= warn ? 'warn' : 'ok');

/** 磁盘用量百分比：total 为 0 的异常数据按 0 处理，避免 NaN 宽度撑爆布局 */
const diskPct = (disk: { used: number; total: number }): number =>
  disk.total > 0 ? (disk.used / disk.total) * 100 : 0;

type ServerMeterRowProps = {
  icon: ReactNode;
  label: string;
  valueText: string;
  pct: number;
  tone: MeterTone;
  /** 磁盘行悬停用原生 title 展示全部分区（与原型一致，不引 tooltip 原语） */
  title?: string;
};

/** 指标行：图标 + 标签 + 「数值 | 细条」三列（原型 meterRowHtml / .srv-row） */
const ServerMeterRow = ({ icon, label, valueText, pct, tone, title }: ServerMeterRowProps) => (
  <div className="grid grid-cols-[1rem_2.5rem_minmax(0,1fr)] items-center gap-2" title={title}>
    <span className="text-muted-foreground flex [&_svg]:size-3.5">{icon}</span>
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="flex min-w-0 items-center gap-2.5">
      <b className="min-w-10 text-right text-xs font-medium tabular-nums">{valueText}</b>
      <span className="bg-secondary flex h-2 flex-1 overflow-hidden rounded-full">
        <span
          className={cn('block h-full rounded-full', METER_TONE_CLASS[tone])}
          style={{ width: `${Math.max(0, Math.min(100, pct)).toFixed(1)}%` }}
        />
      </span>
    </span>
  </div>
);

type ServerTextRowProps = {
  icon: ReactNode;
  label: string;
  children: ReactNode;
};

/** 文本行：图标 + 标签 + 纯文本值（网络 / 运行 / 容器，原型 textRowHtml） */
const ServerTextRow = ({ icon, label, children }: ServerTextRowProps) => (
  <div className="grid grid-cols-[1rem_2.5rem_minmax(0,1fr)] items-center gap-2">
    <span className="text-muted-foreground flex [&_svg]:size-3.5">{icon}</span>
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="min-w-0 text-xs tabular-nums">{children}</span>
  </div>
);

type ServerCardProps = {
  server: ServerItemType;
  onOpen: (id: number) => void;
};

/**
 * 服务器列表卡片（PRD §5.1，beszel SystemCard 同款结构，原型 serverCardHtml）。
 *
 * 四态渲染规则（连接状态以后端 resolveStatus 为准，paused 已折叠进 status）：
 * - 在线：指标行按阈值配色，页脚「在线 + 最后回传相对时间」；
 * - 离线：指标行保留但置灰（tone=mute），页脚注明数据停留的绝对时间；
 * - 已暂停 / 等待连接：整卡置灰（原型 .srv-card.dim）；
 * - 等待连接：latest 为 null（从未回传），不渲染指标行。注意不能只按 status 判断——
 *   暂停一台从未连接的机器，status 同样是 paused 但指标数据并不存在，
 *   直接渲染指标行会访问 null 报错（原型 hasSnapshot 注释同款历史 bug），
 *   因此门控条件统一取「有最新快照数据」。
 */
export const ServerCard = observer(({ server, onOpen }: ServerCardProps) => {
  const status = SERVER_STATUS[server.status];
  const live = server.status === 'online';
  const dimmed = server.status === 'paused' || server.status === 'pending';
  const snapshot = server.latest;

  // 磁盘展示用量最大的挂载点（最可能触警的那个），悬停 title 里列全部分区
  const disks = server.disks ?? [];
  const topDisk = disks.length > 0 ? disks.reduce((top, disk) => (diskPct(disk) > diskPct(top) ? disk : top)) : null;
  const diskTitle = disks.map((disk) => `${disk.mount} ${Math.round(diskPct(disk))}%`).join(' · ');

  const memPct = snapshot && snapshot.mem_total > 0 ? (snapshot.mem_used / snapshot.mem_total) * 100 : 0;

  const footer =
    server.status === 'online' ? (
      <>
        <span className={cn('font-medium', status.text)}>{status.label}</span>
        <span className="ml-auto tabular-nums">{formatServerLastReport(server.last_report_at)}</span>
      </>
    ) : server.status === 'offline' ? (
      // 离线：相对时间会随查看时刻漂移，页脚注明数据停留的绝对时间（原型同款）
      <span className={status.text}>已断开 · 数据停留在 {server.last_report_at ?? '—'}</span>
    ) : (
      <span className={status.text}>{server.status === 'paused' ? '监控已暂停' : '等待首次连接'}</span>
    );

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
        'bg-card hover:border-ring flex min-h-[18.5rem] min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border transition-colors',
        dimmed && 'opacity-55'
      )}
    >
      {/* 头部条：状态点（只用颜色，文字状态放页脚，原型 statusDotHtml）+ 名称 + 分组徽章 */}
      <div className="bg-muted/45 flex min-w-0 items-center gap-2 border-b px-4 py-[0.6875rem]">
        <span className={cn('size-2 shrink-0 rounded-full', status.dot)} title={status.label} />
        <h4 className="truncate text-sm font-semibold">{server.name}</h4>
        {server.group ? (
          <span className="text-muted-foreground ml-auto shrink-0 rounded border px-1.5 text-[11px]">
            {server.group}
          </span>
        ) : null}
      </div>

      {/* 系统信息行：发行版 · CPU 核数 · IP */}
      <div className="text-muted-foreground truncate px-4 pt-3 pb-1 text-xs">
        {server.os_name}
        {server.cpu_cores ? ` · ${server.cpu_cores} 核` : ''}
        {server.ip_address && server.ip_address !== '—' ? ` · ${server.ip_address}` : ''}
      </div>

      {snapshot ? (
        <div className="flex flex-col gap-2 px-4 pt-2 pb-3">
          <ServerMeterRow
            icon={<Cpu />}
            label="CPU"
            valueText={`${snapshot.cpu.toFixed(1)}%`}
            pct={snapshot.cpu}
            tone={live ? meterTone(snapshot.cpu) : 'mute'}
          />
          <ServerMeterRow
            icon={<MemoryStick />}
            label="内存"
            valueText={`${Math.round(memPct)}%`}
            pct={memPct}
            tone={live ? meterTone(memPct) : 'mute'}
          />
          <ServerMeterRow
            icon={<HardDrive />}
            label="磁盘"
            valueText={topDisk ? `${Math.round(diskPct(topDisk))}%` : '—'}
            pct={topDisk ? diskPct(topDisk) : 0}
            tone={live && topDisk ? meterTone(diskPct(topDisk), 80, 90) : 'mute'}
            title={diskTitle}
          />
          <ServerTextRow icon={<Network />} label="网络">
            <span className="whitespace-nowrap">
              ↓ {formatServerRate(snapshot.net_rx)}&nbsp;&nbsp;↑ {formatServerRate(snapshot.net_tx)}
            </span>
          </ServerTextRow>
          <ServerTextRow icon={<Clock />} label="运行">
            {formatServerUptime(snapshot.uptime)}
          </ServerTextRow>
          {/* 列表接口只回容器总数（ServersGetController docker_count）；运行中 / 总数拆分在详情页 Docker 区 */}
          <ServerTextRow icon={<Container />} label="容器">{`${server.docker_count} 个`}</ServerTextRow>
        </div>
      ) : null}

      {/* 页脚：状态文字 + 最后回传（暂停 / 等待连接仅状态文字，PRD §5.1） */}
      <div className="text-muted-foreground mt-auto flex items-center gap-1.5 border-t px-4 py-2.5 text-xs">
        {footer}
      </div>
    </div>
  );
});
