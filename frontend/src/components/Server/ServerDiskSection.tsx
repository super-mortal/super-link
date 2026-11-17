import { HardDrive } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { UsageMeter, diskPct, meterTone } from '@/components/Server/UsageMeter.tsx';
import { formatServerBytes, formatServerPercent } from '@/lib/serverFormat.ts';
import type { ServerDiskType } from '@/lib/types.ts';

/**
 * 磁盘阈值（PRD §5.5「超 80% 警示色，超 90% 危险色」，原型 diskRowHtml 同款）：
 * 与列表卡片磁盘 meter 完全同口径——Disk 调用方把 80 / 90 传给共享的 meterTone，
 * 配色来自同一份 METER_TONE_CLASS（见 UsageMeter.tsx），不存在第二套实现。
 * 磁盘用量涨得慢，比 CPU / 内存 meter 的 65 / 90 放宽一档。
 */
const DISK_WARN_PCT = 80;
const DISK_CRIT_PCT = 90;

type ServerDiskRowProps = {
  disk: ServerDiskType;
};

/**
 * 单行挂载点（原型 .disk-row）：名称（mono，与原型 .mono 一致）+
 * 「used / total · 百分比」右对齐 + 下方独占一行的用量条。
 * 容量与百分比统一走 serverFormat 的 formatServerBytes / formatServerPercent
 * （单位换算只发生在 serverFormat，组件不自己算 GB / TB）。
 */
const ServerDiskRow = ({ disk }: ServerDiskRowProps) => {
  const pct = diskPct(disk);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate font-mono">{disk.mount}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {formatServerBytes(disk.used)} / {formatServerBytes(disk.total)} · {formatServerPercent(pct)}
        </span>
      </div>
      <UsageMeter pct={pct} tone={meterTone(pct, DISK_WARN_PCT, DISK_CRIT_PCT)} className="w-full" />
    </div>
  );
};

type ServerDiskSectionProps = {
  /** 各挂载点最新用量（server_disks 最新一批，PRD §5.3） */
  disks: ServerDiskType[];
};

/**
 * 详情页磁盘区（PRD §5.5，原型 srv-detail-main 第一张 detail-card）：
 * 各挂载点用量条列表，卡头右侧带挂载点计数（原型 .ro「N 个挂载点」）。
 *
 * 空态（与原型一致）：无磁盘数据时展示「等待首次上报后展示。」——
 * agent 从未回传、或列表数据尚未加载（磁盘数据来源见 ServerDetailPage 注释）。
 */
export const ServerDiskSection = ({ disks }: ServerDiskSectionProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <HardDrive className="text-muted-foreground size-4" aria-hidden="true" />
        磁盘
        <span className="text-muted-foreground ml-auto text-xs font-normal">{disks.length} 个挂载点</span>
      </CardTitle>
    </CardHeader>
    <CardContent>
      {disks.length > 0 ? (
        <div className="flex flex-col gap-3.5">
          {disks.map((disk) => (
            <ServerDiskRow key={disk.mount} disk={disk} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">等待首次上报后展示。</p>
      )}
    </CardContent>
  </Card>
);
