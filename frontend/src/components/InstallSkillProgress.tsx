import { AlertCircle, Check, Circle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner.tsx';
import { cn } from '@/lib/utils.ts';
import {
  SKILL_INSTALL_STAGES,
  formatSkillInstallElapsed,
  getSkillInstallStageIndex,
  type SkillInstallPhaseType,
} from '@/lib/skillInstall.ts';

type InstallSkillProgressProps = {
  phase: SkillInstallPhaseType;
  /** 后端返回的当前阶段 key（connect / clone / verify / write），pending 时为空串 */
  stage: string;
  elapsedSeconds: number;
  /** 失败摘要 / 超时提示 */
  message?: string;
  skillName?: string;
  sourceUrl?: string;
};

const PHASE_LABELS: Record<SkillInstallPhaseType, string> = {
  pending: '等待开始',
  running: '正在安装',
  success: '安装完成',
  failed: '安装失败',
  timeout: '等待超时',
};

/**
 * Skill 安装进度（refinements-v0.1.2 §4.4 方案 B）
 *
 * 后端 worker 按阶段回写 stage，git clone 本身不返回百分比，
 * 所以只用「阶段列表 + 不确定进度条 + 已用时长」表达进度。
 * 纯展示组件：轮询、清理定时器与状态切换都在 InstallSkillDialog。
 */
export const InstallSkillProgress = ({
  phase,
  stage,
  elapsedSeconds,
  message,
  skillName,
  sourceUrl,
}: InstallSkillProgressProps) => {
  const isSuccess = phase === 'success';
  const isFailed = phase === 'failed';
  const isPending = phase === 'pending';
  const isRunning = phase === 'running';
  // pending 时还没有 stage，按第一段「连接仓库」高亮，等 worker 回写首个阶段
  const barActive = isPending || isRunning;
  const activeIndex = Math.max(0, getSkillInstallStageIndex(stage));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px] font-medium">{skillName || sourceUrl || 'Skill'}</span>
        <span className="text-muted-foreground shrink-0 text-xs">已用 {formatSkillInstallElapsed(elapsedSeconds)}</span>
      </div>

      <div className="flex flex-col gap-2">
        <span
          className={cn(
            'text-xs font-medium',
            barActive && 'text-muted-foreground',
            isSuccess && 'text-foreground',
            isFailed && 'text-destructive'
          )}
        >
          {PHASE_LABELS[phase]}
        </span>
        {(barActive || isSuccess) && (
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                'bg-primary h-full rounded-full',
                barActive ? 'skill-install-indeterminate w-1/3' : 'w-full'
              )}
            />
          </div>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {SKILL_INSTALL_STAGES.map((item, index) => {
          const completed = isSuccess || index < activeIndex;
          const active = !isSuccess && index === activeIndex;
          const failedHere = isFailed && active;

          return (
            <li key={item.key} className="flex items-center gap-2.5 text-[13px]">
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full',
                  completed && 'bg-primary text-primary-foreground',
                  failedHere && 'text-destructive'
                )}
              >
                {completed ? (
                  <Check className="size-3" />
                ) : failedHere ? (
                  <AlertCircle className="size-4" />
                ) : active && isRunning ? (
                  <Spinner className="text-primary size-3.5" />
                ) : (
                  <Circle className="text-muted-foreground size-3" />
                )}
              </span>
              <span
                className={cn(
                  'truncate',
                  completed || active ? 'text-foreground' : 'text-muted-foreground',
                  active && barActive && 'font-medium',
                  failedHere && 'text-destructive'
                )}
              >
                {item.label}
              </span>
              {active && isPending && <span className="text-muted-foreground ml-auto shrink-0 text-xs">等待开始</span>}
              {active && isRunning && <span className="text-muted-foreground ml-auto shrink-0 text-xs">进行中</span>}
              {failedHere && <span className="text-destructive ml-auto shrink-0 text-xs">失败</span>}
            </li>
          );
        })}
      </ul>

      {message && (isFailed || phase === 'timeout') && (
        <div
          className={cn(
            'flex gap-2 rounded-md p-3 text-xs leading-relaxed',
            isFailed ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-muted-foreground'
          )}
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="no-scrollbar max-h-32 overflow-y-auto break-words">{message}</span>
        </div>
      )}

      <p className="text-muted-foreground text-xs leading-relaxed">
        git clone 不返回精确百分比，以上为后端实时回写的安装阶段。
      </p>
    </div>
  );
};
