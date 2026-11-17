import { Container } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { cn } from '@/lib/utils.ts';
import { formatServerBytes, formatServerRate } from '@/lib/serverFormat.ts';
import type { ServerDockerType } from '@/lib/types.ts';

/**
 * 容器状态语义色（原型 .srv-docker-state：圆点 + 文字、不用底色 chip，密集表格里更安静）：
 * running 绿、exited 灰、paused / restarting / created 等过渡态琥珀（既没跑也没退出，
 * 需要留意）、dead 红。state 取值来自 Docker Engine API 的 Status 字段
 * （created / running / paused / restarting / removing / exited / dead），
 * 白名单外的意外值按灰处理，不让未知状态顶着警示色。
 * 配色写法与 serverFormat 的 SERVER_STATUS 同款：语义调色板类 + dark: 变体，不写死十六进制。
 */
const DOCKER_STATE_STYLE: Record<string, { dot: string; text: string }> = {
  running: { dot: 'bg-green-500', text: 'text-green-700 dark:text-green-300' },
  exited: { dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  restarting: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  created: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  dead: { dot: 'bg-destructive', text: 'text-destructive' },
};

const DOCKER_STATE_FALLBACK = { dot: 'bg-muted-foreground', text: 'text-muted-foreground' };

/** 状态单元格（原型 srv-docker-state）：圆点 + 文字；running 显示「运行中」，其余展示 agent 上报的原始 state（原型同款，不翻译） */
const ServerDockerState = ({ state }: { state: string }) => {
  const style = DOCKER_STATE_STYLE[state] ?? DOCKER_STATE_FALLBACK;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs whitespace-nowrap', style.text)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
      {state === 'running' ? '运行中' : state}
    </span>
  );
};

type ServerDockerSectionProps = {
  /** 最新一批容器快照（detail 出参 docker，PRD §5.3；Docker 不可用或没有容器时为空数组） */
  containers: ServerDockerType[];
  /** agent 是否曾回传（last_report_at 非空）——空态二分的判别键，见下方注释 */
  hasReported: boolean;
};

/**
 * 详情页 Docker 区（PRD §5.3 / §5.5，原型 srv-detail-main 第二张 detail-card）：
 * 容器表格（名称 / 状态 / CPU / 内存 / 网络），卡头右侧带容器计数（原型 .ro「N 个」）。
 *
 * 表格用语义化 table 而非 react-table：列固定、无排序 / 分页 / 列隐藏需求，
 * 数据是「一次快照每容器一行」的只读明细（账号库 AccountTable 的 react-table
 * 是为列表页的交互服务的，这里套用只会增加间接层）。样式对照原型 .srv-table：
 * 表头 muted + 细边框、行分隔线、第 3 列起 tabular-nums、容器名与网络列 mono。
 *
 * 空态二分：后端出参无法区分「没装 Docker」与「没有容器」（两者都是空数组，见
 * ServersDetailController 注释），改用连接状态判别——agent 从未回传
 * （last_report_at 为空，等待连接）展示「等待首次上报后展示。」；曾回传过但
 * 容器快照为空，说明被监控机没装 Docker 或没有容器，展示「未发现 Docker 容器，
 * 或未安装 Docker。」。原型以 online 为判别键，实现改用 last_report_at：离线 /
 * 暂停的机器同样曾回传，其末份快照为空即说明没装 Docker，语义更准。
 *
 * 列格式对照原型 dockerRowHtml：CPU 保留 1 位小数；内存展示用量
 * （原型只有 mem 一个值，后端另有 mem_limit，但列格式从原型不展示 limit）；
 * 网络 rx / tx 为字节每秒，走 formatServerRate 换算。
 */
export const ServerDockerSection = ({ containers, hasReported }: ServerDockerSectionProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <Container className="text-muted-foreground size-4" aria-hidden="true" />
        Docker 容器
        <span className="text-muted-foreground ml-auto text-xs font-normal">{containers.length} 个</span>
      </CardTitle>
    </CardHeader>
    <CardContent>
      {containers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-muted-foreground border-b text-left font-medium">
                <th className="px-3 py-1.5 whitespace-nowrap">容器</th>
                <th className="px-3 py-1.5 whitespace-nowrap">状态</th>
                <th className="px-3 py-1.5 whitespace-nowrap">CPU</th>
                <th className="px-3 py-1.5 whitespace-nowrap">内存</th>
                <th className="px-3 py-1.5 whitespace-nowrap">网络 ↓/↑</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((item) => (
                <tr key={item.container} className="last:[&>td]:border-b-0">
                  <td className="border-border border-b px-3 py-2 font-mono whitespace-nowrap">{item.container}</td>
                  <td className="border-border border-b px-3 py-2 whitespace-nowrap">
                    <ServerDockerState state={item.state} />
                  </td>
                  <td className="border-border border-b px-3 py-2 whitespace-nowrap tabular-nums">
                    {item.cpu.toFixed(1)}%
                  </td>
                  <td className="border-border border-b px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatServerBytes(item.mem_used)}
                  </td>
                  <td className="border-border border-b px-3 py-2 font-mono whitespace-nowrap tabular-nums">
                    {`↓ ${formatServerRate(item.net_rx)} ↑ ${formatServerRate(item.net_tx)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {hasReported ? '未发现 Docker 容器，或未安装 Docker。' : '等待首次上报后展示。'}
        </p>
      )}
    </CardContent>
  </Card>
);
