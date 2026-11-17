import { Activity } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { ServerMetricChartCard } from '@/components/Server/ServerMetricChartCard.tsx';
import { useChartTokens } from '@/components/Server/chartTokens.ts';
import { SERVER_RANGES } from '@/lib/serverFormat.ts';
import type { ServerMetricsSeriesType, ServerRangeType, ServerStatusType } from '@/lib/types.ts';

type ServerMetricsSectionProps = {
  /** 当前 range 的指标序列（页面轮询写入）；null = 尚未拉到 */
  series: ServerMetricsSeriesType | null;
  /** 指标拉取中（store.serverMetricsLoading） */
  loading: boolean;
  /** 当前范围档位（页面 state，默认 SERVER_DEFAULT_RANGE '6h'） */
  range: ServerRangeType;
  onRangeChange: (range: ServerRangeType) => void;
  /** 仅用于空态文案区分：等待连接 vs 时段无数据 */
  status: ServerStatusType;
};

/**
 * 详情页图表区（PRD §5.5，原型 srv-charts-head + srv-charts，决策 D9 recharts）。
 *
 * 外壳：标题 + 范围切换（1h / 6h / 24h / 30d）+ 三图网格；无数据时整区退为空态卡
 * （等待首次上报 / 时段无数据），不渲染图表也不崩。
 *
 * range 状态不放这里而由页面持有：轮询按当前 range 拉取 fetchServerMetrics
 * （见 ServerDetailPage 的 effect），本组件只负责呈现与发出切换意图。
 */
export const ServerMetricsSection = ({ series, loading, range, onRangeChange, status }: ServerMetricsSectionProps) => {
  // 语义色统一在此解析一次，向下传给三张图卡（各自解析会起三份 MutationObserver）
  const tokens = useChartTokens();
  const points = series?.points ?? [];

  // 加载指示只在「可见数据与所选 range 不一致」时出现：切换 range / 首屏加载。
  // 30s 轮询刷新同 range 数据时不显示——那会每 30s 闪一下，反而干扰
  const showLoading = loading && (series === null || series.range !== range);
  // 首屏 / 切 range 后尚未拿到任何序列时显示骨架，避免空态文案闪一下就换图表；
  // 已拿到序列（哪怕 0 点）就走空态，不随轮询反复闪骨架
  const showSkeleton = series === null && loading;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium">历史趋势</h2>
        <div className="flex items-center gap-2">
          {showLoading ? <Spinner className="text-muted-foreground size-3.5" /> : null}
          <ToggleGroup
            variant="outline"
            size="sm"
            type="single"
            value={range}
            onValueChange={(value: ServerRangeType) => {
              // Radix 单选组再次点击已选项会回调空串：range 没有「取消」语义，忽略
              if (value) {
                onRangeChange(value);
              }
            }}
          >
            {SERVER_RANGES.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value} className="px-2 text-[12px]">
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {points.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ServerMetricChartCard kind="cpu" points={points} hourly={range === '30d'} tokens={tokens} />
          <ServerMetricChartCard kind="mem" points={points} hourly={range === '30d'} tokens={tokens} />
          <ServerMetricChartCard kind="net" points={points} hourly={range === '30d'} tokens={tokens} />
        </div>
      ) : showSkeleton ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-[220px] rounded-xl" />
          <Skeleton className="h-[220px] rounded-xl" />
          <Skeleton className="h-[220px] rounded-xl" />
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="bg-secondary text-muted-foreground flex size-12 items-center justify-center rounded-lg">
              <Activity className="size-6" aria-hidden="true" />
            </div>
            <p className="text-muted-foreground text-sm">
              {status === 'pending' ? '等待首次上报后展示。' : '该时间范围内暂无指标数据。'}
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
};
