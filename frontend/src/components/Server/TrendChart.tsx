import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { ChartTokens } from '@/components/Server/chartTokens.ts';
import { CHART_HEIGHT, type ChartPointType } from '@/components/Server/serverChartData.ts';

/**
 * 趋势图（原型 areaChartHtml 的 recharts 实现，决策 D9）。
 *
 * - 面积图：渐变填充（顶 28% → 底 0%）+ 实色描边，用于 CPU / 内存（0–100%）；
 * - 折线：实线或虚线，用于网络 rx / tx 双序列（原型 .lg-line / .lg-line.dash）。
 * 颜色一律由调用方传入解析后的语义色值，组件内不出现任何硬编码色（见 chartTokens.ts）。
 */
export type TrendSeriesConfig = {
  /** 数据键（ChartPointType 的指标字段） */
  dataKey: 'cpu' | 'mem' | 'netRx' | 'netTx';
  /** 展示名（Tooltip 行） */
  name: string;
  /** 已解析的语义色值 */
  color: string;
  kind: 'area' | 'line';
  /** 折线虚线（网络发送，原型同款） */
  dashed?: boolean;
  /** 面积图渐变 id（kind 为 area 时必填，全局唯一） */
  gradientId?: string;
};

type ChartTooltipProps = TooltipContentProps & {
  series: TrendSeriesConfig[];
  formatValue: (value: number) => string;
  formatLabel: (ts: number) => string;
};

/** 自定义 Tooltip：recharts 默认样式是硬编码白底黑字，暗色主题不可用，故自绘（语义色卡片） */
const ChartTooltip = ({ active, payload, label, series, formatValue, formatLabel }: ChartTooltipProps) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-[11px] shadow-md">
      <p className="text-muted-foreground mb-1">{formatLabel(Number(label))}</p>
      {payload.map((entry) => {
        const config = series.find((item) => item.dataKey === entry.dataKey);
        if (!config) {
          return null;
        }
        return (
          <p key={String(entry.dataKey)} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color ?? config.color }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{config.name}</span>
            <b className="font-medium tabular-nums">{formatValue(Number(entry.value))}</b>
          </p>
        );
      })}
    </div>
  );
};

type TrendChartProps = {
  data: ChartPointType[];
  series: TrendSeriesConfig[];
  tokens: ChartTokens;
  /** Y 轴三格刻度（原型 0 / 中 / 顶 三条网格线） */
  yTicks: number[];
  formatY: (value: number) => string;
  /** X 轴首 / 中 / 末三个刻度（原型 rangeLabels 三点口径），密集档位下避免标签重叠 */
  xTicks: number[];
  formatX: (ts: number) => string;
  /** Tooltip 时间标签 */
  formatLabel: (ts: number) => string;
  /** Tooltip 数值格式 */
  formatValue: (value: number) => string;
};

export const TrendChart = ({
  data,
  series,
  tokens,
  yTicks,
  formatY,
  xTicks,
  formatX,
  formatLabel,
  formatValue,
}: TrendChartProps) => {
  // 单点数据时折线 / 面积是零长度路径、不可见，补一个圆点让「只有一个点」可感知；
  // 横轴域同样加一分钟 padding——数值轴在 dataMin === dataMax 时求不出有效刻度
  const singlePoint = data.length === 1;

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
        // 轮询每 30s 替换数据，入场动画会反复闪；关闭动画保持稳定
      >
        {series.map((item) =>
          item.kind === 'area' && item.gradientId ? (
            <defs key={item.gradientId}>
              <linearGradient id={item.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={item.color} stopOpacity={0} />
              </linearGradient>
            </defs>
          ) : null
        )}
        <CartesianGrid vertical={false} stroke={tokens.grid} strokeDasharray="3 4" />
        <XAxis
          type="number"
          dataKey="ts"
          domain={singlePoint ? [data[0].ts - 60_000, data[0].ts + 60_000] : ['dataMin', 'dataMax']}
          ticks={xTicks}
          tickFormatter={formatX}
          tick={{ fontSize: 10, fill: tokens.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          ticks={yTicks}
          tickFormatter={formatY}
          tick={{ fontSize: 10, fill: tokens.axis }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ stroke: tokens.grid }}
          content={(props) => (
            <ChartTooltip {...props} series={series} formatValue={formatValue} formatLabel={formatLabel} />
          )}
        />
        {series.map((item) =>
          item.kind === 'area' ? (
            <Area
              key={String(item.dataKey)}
              type="linear"
              dataKey={item.dataKey}
              name={item.name}
              stroke={item.color}
              strokeWidth={1.8}
              fill={`url(#${item.gradientId})`}
              dot={singlePoint ? { r: 2.5, fill: item.color, stroke: item.color, strokeWidth: 0 } : false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={String(item.dataKey)}
              type="linear"
              dataKey={item.dataKey}
              name={item.name}
              stroke={item.color}
              strokeWidth={1.4}
              strokeDasharray={item.dashed ? '5 4' : undefined}
              dot={singlePoint ? { r: 2.5, fill: item.color, stroke: item.color, strokeWidth: 0 } : false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          )
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
};
