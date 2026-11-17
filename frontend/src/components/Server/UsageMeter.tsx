import { cn } from '@/lib/utils.ts';

/**
 * 用量 meter 共享原语（列表卡片指标行与详情页磁盘区共用，PRD §5.1 / §5.5）。
 *
 * 为什么单独抽一个文件：meter 的配色档位（METER_TONE_CLASS）、阈值函数
 * （meterTone）与磁盘百分比换算（diskPct）原先只存在于 ServerCard 内部，
 * 详情页磁盘区若复制一份就会出现「同一口径两处实现、改一处漏一处」的问题
 * （AGENTS.md：能复用的 UI 必须组件化，禁止复制粘贴）。ServerCard 改为从这里
 * 引用，渲染结果与抽取前完全一致（同类名、同宽度计算）。
 */

/** meter 细条配色档位（原型 .bar > i 的 ok / warn / err / mute，见 mockups/styles.css） */
export type MeterTone = 'ok' | 'warn' | 'err' | 'mute';

export const METER_TONE_CLASS: Record<MeterTone, string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-500',
  err: 'bg-destructive',
  // 离线卡片整体置灰时用：细条变灰但不消失，保持三列结构稳定
  mute: 'bg-muted-foreground/45',
};

/**
 * meter 阈值配色（beszel colorWarn / colorCrit 同款，PRD §5.1）：
 * CPU / 内存按 65 黄 / 90 红；磁盘按 80 黄 / 90 红——磁盘用量涨得慢，阈值放宽一档
 * （磁盘调用方传 meterTone(pct, 80, 90)，与原型 diskRowHtml 同口径）。
 */
export const meterTone = (pct: number, warn = 65, crit = 90): MeterTone =>
  pct >= crit ? 'err' : pct >= warn ? 'warn' : 'ok';

/** 磁盘用量百分比：total 为 0 的异常数据按 0 处理，避免 NaN 宽度撑爆布局 */
export const diskPct = (disk: { used: number; total: number }): number =>
  disk.total > 0 ? (disk.used / disk.total) * 100 : 0;

type UsageMeterProps = {
  /** 用量百分比（0–100，超出范围截断，防止填充溢出轨道） */
  pct: number;
  tone: MeterTone;
  /** 轨道附加类：列表卡片里传 flex-1 与数值并列，磁盘区传 w-full 独占一行 */
  className?: string;
};

/**
 * 用量细条（原型 .bar / .disk-bar 同款结构）：轨道 + 按阈值配色的填充，
 * 填充宽度取 pct（保留 1 位小数，与原型 style="width:x.x%" 一致）。
 */
export const UsageMeter = ({ pct, tone, className }: UsageMeterProps) => (
  <span className={cn('bg-secondary flex h-2 overflow-hidden rounded-full', className)}>
    <span
      className={cn('block h-full rounded-full', METER_TONE_CLASS[tone])}
      style={{ width: `${Math.max(0, Math.min(100, pct)).toFixed(1)}%` }}
    />
  </span>
);
