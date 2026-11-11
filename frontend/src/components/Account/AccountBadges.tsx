import { AlertTriangle, Lock, ShieldCheck, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import type { AccountAuthorizationStatusType } from '@/lib/types.ts';

/** 平台徽章：卡片标题行、列表标题行、表格「平台」列共用 */
export const PlatformBadge = ({ platform, className }: { platform: string; className?: string }) => (
  <span
    className={cn(
      'bg-secondary text-secondary-foreground inline-flex max-w-40 min-w-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
      className
    )}
    title={platform}
  >
    <span className="truncate">{platform}</span>
  </span>
);

/**
 * 2FA 状态徽章（PRD §10.4）。
 *
 * enabled 由列表接口返回的 totp 密文是否存在推断：服务端没有 DEK、列表态也解不开
 * secret，只能标记「已配置」；动态码在详情页按需解密后生成（task10）。
 */
export const TotpBadge = ({ enabled }: { enabled: boolean }) =>
  enabled ? (
    <span
      className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      title="已配置两步验证"
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      2FA 已开启
    </span>
  ) : (
    <span
      className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
      title="未配置两步验证"
    >
      <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
      2FA 未开启
    </span>
  );

/**
 * 「待处理」徽章（PRD §10.4）：未开 2FA，或密码超过 365 天未修改。
 * 判定逻辑在 lib/accountFormat.ts（纯函数），这里只负责展示；
 * 琥珀配色沿用 Skill「有更新」徽章的明暗两套色阶，不写死 hex。
 */
export const PendingBadge = () => (
  <span
    className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300"
    title="未开启两步验证，或密码超过 365 天未修改"
  >
    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
    待处理
  </span>
);

/**
 * 备注加密提示：备注是密文字段，列表 / 卡片态不解密（task10 按需解密后进内存缓存），
 * 只提示「已加密」并指引到详情页，绝不渲染任何占位「明文」。
 */
export const EncryptedNotesHint = () => (
  <p className="text-muted-foreground flex items-center gap-1 text-xs">
    <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
    备注已加密，解锁后在详情页查看
  </p>
);

/**
 * 授权状态徽章（PRD §6.4 / §10.4）：active 生效中、revoked 已失效。
 * revoked 沿用「待处理」的琥珀色系（授权被撤销后仍可能有用例回溯，不需要红色告警）。
 */
export const AuthorizationStatusBadge = ({ status }: { status: AccountAuthorizationStatusType }) =>
  status === 'active' ? (
    <span
      className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      title="该授权仍然有效"
    >
      生效中
    </span>
  ) : (
    <span
      className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300"
      title="该授权已被撤销"
    >
      已失效
    </span>
  );
