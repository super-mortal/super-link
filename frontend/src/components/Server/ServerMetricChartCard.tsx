import { useMemo } from 'react';
import { Cpu, MemoryStick, Network } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { TrendChart, type TrendSeriesConfig } from '@/components/Server/TrendChart.tsx';
import type { ChartTokens } from '@/components/Server/chartTokens.ts';
import {
  chartStats,
  downsamplePoints,
  formatAxisValue,
  formatChartTooltipLabel,
  formatChartXLabel,
  niceMax,
  toChartPoints,
} from '@/components/Server/serverChartData.ts';
import type { ServerMetricsPointType } from '@/lib/types.ts';

/** 三类图表（原型 chartCardHtml 的 kind 入参） */
type MetricKind = 'cpu' | 'mem' | 'net';

type ServerMetricChartCardProps = {
  kind: MetricKind;
  /** 全量序列（received_at 升序，后端保证）：统计按全量计算，渲染前抽样 */
  points: ServerMetricsPointType[];
  /** 30d 档为服务端小时聚合桶（决策 D4），横轴显示月-日；其余档显示时:分 */
  hourly: boolean;
  /** 语义色值（chartTokens.ts 从 index.css 设计 token 解析，暗色两套自动跟随） */
  tokens: ChartTokens;
};

/** 每类图的标题与图标（原型 chartCardHtml 的 conf 表） */
const METRIC_CONFIG: Record<MetricKind, { title: string; icon: typeof Cpu }> = {
  cpu: { title: 'CPU 使用率', icon: Cpu },
  mem: { title: '内存使用率', icon: MemoryStick },
  net: { title: '网络吞吐', icon: Network },
};

/**
 * 单张指标图卡（原型 chartCardHtml 的 recharts 实现，决策 D9）。
 *
 * - CPU / 内存：面积图（--chart-1 / --chart-2），Y 轴固定 0–100%（内存为 used/total 百分比）；
 * - 网络：rx / tx 双线（--chart-3 实线接收 / --chart-4 虚线发送），Y 轴按峰值取整；
 * - 三卡共用底部统计行（当前 / 峰值 / 均值，原型 chartFoot 一行 nowrap 版式）。
 */
export const ServerMetricChartCard = ({ kind, points, hourly, tokens }: ServerMetricChartCardProps) => {
  // 统计按全量序列求值（原型同款：chartCardHtml 对未抽样的 series 求统计），抽样只服务于渲染
  const all = useMemo(() => toChartPoints(points), [points]);
  const sampled = useMemo(() => downsamplePoints(all), [all]);
  const isNet = kind === 'net';
  const { title, icon: Icon } = METRIC_CONFIG[kind];

  const series: TrendSeriesConfig[] = isNet
    ? [
        { dataKey: 'netRx', name: '接收', color: tokens.chart3, kind: 'line' },
        { dataKey: 'netTx', name: '发送', color: tokens.chart4, kind: 'line', dashed: true },
      ]
    : [
        {
          dataKey: kind === 'cpu' ? 'cpu' : 'mem',
          name: title,
          color: kind === 'cpu' ? tokens.chart1 : tokens.chart2,
          kind: 'area',
          gradientId: `${kind}-area-gradient`,
        },
      ];

  // 统计口径（原型 chartCardHtml）：当前 = 最后一点，峰值 = 最大值，均值 = 算术平均；
  // 网络档取接收（rx）——与原型一致，发送侧看图形即可
  const stats = chartStats(all.map((point) => (isNet ? point.netRx : kind === 'cpu' ? point.cpu : point.mem)));

  // CPU / 内存固定 0–100%；网络按峰值抬到易读刻度（原型 niceMax，rx/tx 取并集防折线贴顶）
  const yMax = isNet
    ? niceMax(Math.max(stats.peak, ...all.map((point) => Math.max(point.netRx, point.netTx)), 0.1))
    : 100;
  const yTicks = isNet ? [0, yMax / 2, yMax] : [0, 50, 100];

  // 横轴只放首 / 中 / 末三个刻度（原型 rangeLabels 三点口径）：24h / 30d 档点数远超卡片
  // 像素宽度，密排标签必然重叠。取数据自身的首中末而非时间窗——agent 中途接入时数据
  // 没铺满整个 range，轴范围应反映真实数据
  const xTicks = useMemo(() => {
    if (sampled.length === 0) {
      return [];
    }
    if (sampled.length === 1) {
      return [sampled[0].ts];
    }
    return [sampled[0].ts, sampled[Math.floor((sampled.length - 1) / 2)].ts, sampled[sampled.length - 1].ts];
  }, [sampled]);

  const formatValue = (value: number) => (isNet ? `${value.toFixed(1)} MB/s` : `${value.toFixed(1)}%`);
  const formatY = (value: number) => (isNet ? formatAxisValue(value) : `${formatAxisValue(value)}%`);

  // 统计行数值（原型 chartFoot）：网络档三个值共用 MB/s 单位、只挂在均值上缩短行宽，
  // 防窄卡片换行；百分比档每个值都带 %
  const statValue = (value: number, withUnit: boolean) => (
    <b className="text-foreground font-medium tabular-nums">
      {value.toFixed(1)}
      {isNet ? (withUnit ? ' MB/s' : '') : '%'}
    </b>
  );

  const statsFoot = (
    <div className="text-muted-foreground mt-1 flex flex-nowrap gap-3 overflow-hidden text-[11px] whitespace-nowrap">
      <span>当前 {statValue(stats.current, false)}</span>
      <span>峰值 {statValue(stats.peak, false)}</span>
      <span>均值 {statValue(stats.avg, true)}</span>
    </div>
  );

  // 网络图例（原型 .chart-legend / .lg-line）：色条与折线同源（均取自 chartTokens）
  const legend = isNet ? (
    <span className="text-muted-foreground inline-flex items-center gap-2.5 text-[11px]">
      <span className="inline-flex items-center gap-1">
        <i className="inline-block w-3.5 border-t-2" style={{ borderColor: tokens.chart3 }} aria-hidden="true" />
        接收
      </span>
      <span className="inline-flex items-center gap-1">
        <i
          className="inline-block w-3.5 border-t-2 border-dashed"
          style={{ borderColor: tokens.chart4 }}
          aria-hidden="true"
        />
        发送
      </span>
    </span>
  ) : null;

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col px-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[13px] font-medium">
            <Icon className="text-muted-foreground size-3.5" aria-hidden="true" />
            {title}
          </span>
          {legend}
        </div>
        <TrendChart
          data={sampled}
          series={series}
          tokens={tokens}
          yTicks={yTicks}
          formatY={formatY}
          xTicks={xTicks}
          formatX={(ts) => formatChartXLabel(ts, hourly)}
          formatLabel={formatChartTooltipLabel}
          formatValue={formatValue}
        />
        {statsFoot}
      </CardContent>
    </Card>
  );
};
