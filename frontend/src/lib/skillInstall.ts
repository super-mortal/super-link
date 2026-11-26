import type { SkillInstallTaskStatusType } from '@/lib/types.ts';

/**
 * Skill 安装进度展示用的纯函数与常量（refinements-v0.1.2 §4.4 方案 B）
 *
 * 阶段 key 与后端 `Utils\SkillInstaller` 的 STAGE_* 常量、以及
 * `skill_install_tasks.stage` 的取值一一对应；文案改动只改这里。
 */

/** 前端展示态：后端任务状态 + 本地轮询超时（超时不一定失败，任务可能仍在后台执行） */
export type SkillInstallPhaseType = SkillInstallTaskStatusType | 'timeout';

export type SkillInstallStageType = {
  key: string;
  label: string;
};

export const SKILL_INSTALL_STAGES: SkillInstallStageType[] = [
  { key: 'connect', label: '连接仓库' },
  { key: 'clone', label: '克隆仓库' },
  { key: 'verify', label: '校验 SKILL.md' },
  { key: 'write', label: '写入 storage/skills' },
];

/** 后端 stage 值 → 阶段序号；pending 时 stage 为空串，返回 -1 由调用方按第一段处理 */
export const getSkillInstallStageIndex = (stage: string): number =>
  SKILL_INSTALL_STAGES.findIndex((item) => item.key === stage);

/** 已用时长：后端给的是秒数（进行中实时计算、结束后固定），这里只做展示格式化 */
export const formatSkillInstallElapsed = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;

  return minutes > 0 ? `${minutes} 分 ${String(rest).padStart(2, '0')} 秒` : `${rest} 秒`;
};
