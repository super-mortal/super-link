import { bytesPerSecondToMb } from '@/lib/serverFormat.ts';
import type { ServerMetricsPointType } from '@/lib/types.ts';

/**
 * 详情页图表区的纯数据 helper（原型 serverChartsHtml / areaChartHtml 同款口径，
 * PRD §5.5）。只放「接口序列 → 图表数据 / 统计值」的换算，不含 JSX。
 */

/** 图表渲染的最大点数（原型 downsample 默认 120）：24h / 30d 档原始点数远超卡片像素宽度，抽样后横轴标签才不重叠 */
export const MAX_CHART_POINTS = 120;

/** 图表高度（px）：原型 viewBox 640×180 按卡片宽度等比，取 150 */
export const CHART_HEIGHT = 150;

/** received_at（后端 'Y-m-d H:i:s'，无时区）→ 本地时间戳；无法解析的点整体丢弃，避免横轴出现 NaN */
const toTimestamp = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const ts = new Date(value.replace(' ', 'T')).getTime();
  return Number.isFinite(ts) ? ts : null;
};

/** 图表数据点：时间戳 + 三个指标（内存按 used / total 换算成百分比，与卡片 meter 行同口径） */
export type ChartPointType = {
  ts: number;
  cpu: number;
  mem: number;
  netRx: number;
  netTx: number;
};

/** 接口序列 → 图表数据（全量，不抽样）；统计行按全量计算，抽样只用于渲染 */
export const toChartPoints = (points: ServerMetricsPointType[]): ChartPointType[] => {
  const mapped: ChartPointType[] = [];

  for (const point of points) {
    const ts = toTimestamp(point.received_at);
    if (ts === null) {
      continue;
    }
    mapped.push({
      ts,
      cpu: point.cpu,
      mem: point.mem_total > 0 ? (point.mem_used / point.mem_total) * 100 : 0,
      netRx: bytesPerSecondToMb(point.net_rx),
      netTx: bytesPerSecondToMb(point.net_tx),
    });
  }

  return mapped;
};

/** 等距抽样（原型 downsample）：保留首末点，中间按步长取，曲线形状不失真 */
export const downsamplePoints = (points: ChartPointType[], max: number = MAX_CHART_POINTS): ChartPointType[] => {
  if (points.length <= max) {
    return points;
  }

  const step = points.length / max;
  const sampled: ChartPointType[] = [];
  for (let index = 0; index < max; index += 1) {
    sampled.push(points[Math.min(points.length - 1, Math.floor(index * step))]);
  }

  return sampled;
};

/**
 * 统计口径（原型 chartCardHtml）：当前 = 最后一点，峰值 = 最大值，均值 = 算术平均。
 * 网络的当前 / 峰值 / 均值取接收（rx）——与原型一致，均值处统一挂 MB/s 单位缩短行宽。
 */
export const chartStats = (values: number[]): { current: number; peak: number; avg: number } => {
  if (values.length === 0) {
    return { current: 0, peak: 0, avg: 0 };
  }

  let sum = 0;
  let peak = values[0];
  for (const value of values) {
    sum += value;
    if (value > peak) {
      peak = value;
    }
  }

  return { current: values[values.length - 1], peak, avg: sum / values.length };
};

/** 网络图 Y 轴上限（原型 niceMax）：把峰值抬到易读刻度，避免折线贴顶 */
export const niceMax = (value: number): number => {
  if (value < 1) {
    return 1;
  }
  if (value < 5) {
    return 5;
  }
  if (value < 10) {
    return 10;
  }
  if (value < 25) {
    return 25;
  }
  if (value < 50) {
    return 50;
  }
  if (value < 100) {
    return 100;
  }
  return Math.ceil(value / 50) * 50;
};

/** Y 轴刻度文本（原型 grid 标签）：最多 1 位小数，不带单位 */
export const formatAxisValue = (value: number): string => String(Math.round(value * 10) / 10);

/**
 * 横轴标签（原型 rangeLabels）：30d 档显示「月-日」，其余档显示「时:分」。
 * 30d 档为服务端小时聚合桶（决策 D4），横轴粒度随之变粗。
 */
export const formatChartXLabel = (ts: number, hourly: boolean): string => {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');

  return hourly
    ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Tooltip 时间标签：统一到「月-日 时:分」，比横轴标签信息更完整 */
export const formatChartTooltipLabel = (ts: number): string => {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
