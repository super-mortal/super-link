import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { formatAccountDate } from '@/lib/accountFormat.ts';
import type { ServerWithStatusType } from '@/lib/types.ts';

/** 信息行：标签左、值右，值可换行截断（原型 .info-row） */
const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-3">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="min-w-0 text-right break-all">{children}</span>
  </div>
);

/**
 * 语义化版本解析（决策 D12）：只认 `x.y.z` 数字三段，容忍 `v` 前缀与缺段（`1.0` 按 `1.0.0`）。
 * 返回 null 表示无法解析（空串 / `—` / 非版本号），调用方不得据此提示升级。
 */
const parseVersion = (value: string): number[] | null => {
  const matched = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value);
  if (!matched) {
    return null;
  }
  return [matched[1], matched[2], matched[3]].map((part) => Number(part ?? 0));
};

/**
 * Agent 是否落后于 Hub（PRD §5.5 版本提示 / 决策 D12，beszel 同款）：
 * 逐段比较，第一处不同即定胜负；同版本或 agent 更高（如在测新版）不提示；
 * 任一侧缺失 / 无法解析时不提示——agent 从未回传时版本列为 `—`、
 * app-info 未加载（GitHub 不可达等）时 Hub 版本为 null，都属于正常情况。
 */
export const isAgentVersionBehind = (agentVersion: string, hubVersion: string | null): boolean => {
  const agent = parseVersion(agentVersion);
  const hub = hubVersion === null ? null : parseVersion(hubVersion);
  if (agent === null || hub === null) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (agent[index] !== hub[index]) {
      return agent[index] < hub[index];
    }
  }
  return false;
};

type ServerBasicInfoCardProps = {
  server: ServerWithStatusType;
  /** Hub 自身版本（app-info 的 installed_version）；null = 尚未加载，不做版本对比 */
  hubVersion: string | null;
};

/**
 * 基本信息卡（PRD §5.5，原型 detail-side 第一张）：系统信息明细 + 连接 / 采集口径 + 创建时间。
 * 后端不存储架构列（原型有、接口不出），故不渲染「架构」行。
 *
 * Agent 版本落后提示（决策 D12，原型未覆盖、按 PRD 补齐）：agent 版本与 Hub 版本不一致且落后时，
 * 在卡内给出琥珀色升级提示；升级方式为重跑安装命令 / 重置 Token 后重装（见接入信息卡与头部按钮）。
 */
export const ServerBasicInfoCard = ({ server, hubVersion }: ServerBasicInfoCardProps) => {
  const agentBehind = isAgentVersionBehind(server.agent_version, hubVersion);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">基本信息</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-[13px]">
        <InfoRow label="系统">{server.os_name || '—'}</InfoRow>
        <InfoRow label="分组">{server.group || '—'}</InfoRow>
        <InfoRow label="内核">
          <span className="font-mono text-xs">{server.kernel || '—'}</span>
        </InfoRow>
        <InfoRow label="CPU">{server.cpu_cores ? `${server.cpu_cores} 核` : '—'}</InfoRow>
        <InfoRow label="地址">
          <span className="font-mono break-all">{server.ip_address || '—'}</span>
        </InfoRow>
        <InfoRow label="Agent 版本">
          <span className="font-mono">{server.agent_version || '—'}</span>
        </InfoRow>
        <InfoRow label="连接方式">长连接（agent 外连）</InfoRow>
        <InfoRow label="采集周期">5 分钟（Hub 下发）</InfoRow>
        <InfoRow label="创建时间">{formatAccountDate(server.created_at)}</InfoRow>

        {agentBehind ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-2 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <b className="font-medium">Agent 版本落后，建议升级</b>
              <br />
              当前 Agent {server.agent_version || '—'}，Hub {hubVersion}。在被监控机器上重新执行安装命令即可完成升级；
              Token 明文不在页面展示，可点上方「重置 Token」获取含新 Token 的完整命令后重装。
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
