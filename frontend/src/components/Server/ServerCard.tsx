import { observer } from 'mobx-react-lite';
import type { KeyboardEvent, ReactNode } from 'react';
import { Clock, Container, Cpu, Folder, HardDrive, MemoryStick, Network, Pause } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { SERVER_STATUS, formatServerLastReport, formatServerRate, formatServerUptime } from '@/lib/serverFormat.ts';
import { UsageMeter, diskPct, meterTone, type MeterTone } from '@/components/Server/UsageMeter.tsx';
import type { ServerItemType } from '@/lib/types.ts';

type ServerMeterRowProps = {
  icon: ReactNode;
  label: string;
  valueText: string;
  pct: number;
  tone: MeterTone;
  /** 磁盘行悬停用原生 title 展示全部分区（与原型一致，不引 tooltip 原语） */
  title?: string;
};

/** 指标行：图标 + 标签 + 「数值 | 细条」三列（原型 meterRowHtml / .srv-row；细条为共享 UsageMeter） */
const ServerMeterRow = ({ icon, label, valueText, pct, tone, title }: ServerMeterRowProps) => (
  <div className="grid grid-cols-[1rem_2.5rem_minmax(0,1fr)] items-center gap-2" title={title}>
    <span className="text-muted-foreground flex [&_svg]:size-3.5">{icon}</span>
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="flex min-w-0 items-center gap-2.5">
      <b className="min-w-10 text-right text-xs font-medium tabular-nums">{valueText}</b>
      <UsageMeter pct={pct} tone={tone} className="flex-1" />
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
  /**
   * 「查看接入指引 →」：打开该服务器详情页并滚动到接入信息卡（refinements §4.1）。
   * 与 onOpen 分开是因为详情页需要知道这次跳转的目标区域，由列表页注入路由 state。
   */
  onOpenInstall: (id: number) => void;
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
 *
 * 无快照时不渲染系统信息行（os_name 为空时那行只剩 padding，看起来像渲染错误），
 * 改用占位块（图标 + 标题 + 说明 + 「查看接入指引 →」）撑满卡片，避免大片留白
 * （refinements §4.1）。分组徽章从头部移到页脚状态行开头（refinements §4.7）：
 * 右上角只留给操作按钮，头部只保留状态点与名称。
 */
export const ServerCard = observer(({ server, onOpen, onOpenInstall }: ServerCardProps) => {
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
      // 无快照：暂停显示「监控已暂停」，等待连接用「尚未回传数据」——不再与占位块标题
      // 「等待 Agent 首次连接」重复（refinements §4.1）
      <span className={status.text}>{server.status === 'paused' ? '监控已暂停' : '尚未回传数据'}</span>
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
      {/* 头部条：只保留状态点（颜色即状态，文字放页脚）与名称；右上角留给操作按钮（refinements §4.7） */}
      <div className="bg-muted/45 flex min-w-0 items-center gap-2 border-b px-4 py-[0.6875rem]">
        <span className={cn('size-2 shrink-0 rounded-full', status.dot)} title={status.label} />
        <h4 className="truncate text-sm font-semibold">{server.name}</h4>
      </div>

      {/* 系统信息行：发行版 · CPU 核数 · IP；未回传时 os_name 为空，整行不渲染，
          避免只剩 padding 的空行（refinements §4.1） */}
      {server.os_name ? (
        <div className="text-muted-foreground truncate px-4 pt-3 pb-1 text-xs">
          {server.os_name}
          {server.cpu_cores ? ` · ${server.cpu_cores} 核` : ''}
          {server.ip_address && server.ip_address !== '—' ? ` · ${server.ip_address}` : ''}
        </div>
      ) : null}

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
      ) : (
        // 无快照占位块：flex-1 吃掉头部与页脚之间的剩余高度，撑满卡片而非留白
        // （refinements §4.1）。图标 / 文案与原型 serverCardHtml 的 .srv-pending 一致
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-5 py-6 text-center">
          <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-full">
            {server.status === 'paused' ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Clock className="size-4" aria-hidden="true" />
            )}
          </span>
          <b className="text-[13px] font-semibold">
            {server.status === 'paused' ? '监控已暂停' : '等待 Agent 首次连接'}
          </b>
          <p className="text-muted-foreground max-w-64 text-xs leading-relaxed">
            {server.status === 'paused'
              ? '恢复监控后继续采集指标；暂停期间不做离线判定。'
              : '在被监控机器上执行安装命令后，这里会自动显示 CPU、内存、磁盘与网络指标。'}
          </p>
          <button
            type="button"
            // 卡片整体是 role=button：点击 / 回车都要阻止冒泡，否则会先按普通打开处理，
            // 丢掉「滚动到接入信息卡」的路由 state
            onClick={(event) => {
              event.stopPropagation();
              onOpenInstall(server.id);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="text-primary mt-1 text-xs hover:underline"
          >
            查看接入指引 →
          </button>
        </div>
      )}

      {/* 页脚：分组徽章 + 状态文字 / 最后回传（分组从头部移到这里，refinements §4.7） */}
      <div className="text-muted-foreground mt-auto flex items-center gap-1.5 border-t px-4 py-2.5 text-xs">
        {server.group ? (
          <span className="inline-flex min-w-0 shrink items-center gap-1">
            <Folder className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{server.group}</span>
          </span>
        ) : null}
        {footer}
      </div>
    </div>
  );
});
