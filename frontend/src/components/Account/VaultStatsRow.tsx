import { Layers, KeyRound, ShieldCheck } from 'lucide-react';

/**
 * 锁定页展示的账号库统计（PRD §10.1）：只含数量，不含任何账号内容。
 */
export type VaultStatsType = {
  total: number;
  totpEnabled: number;
  platforms: number;
};

/**
 * TODO(后续任务)：账号列表接口接入后由页面传入真实统计值。
 * 现在账号数据还不存在，统一渲染 0，避免锁定页出现空位。
 */
export const EMPTY_VAULT_STATS: VaultStatsType = { total: 0, totpEnabled: 0, platforms: 0 };

const STAT_ITEMS = [
  { key: 'total', label: '账号总数', icon: KeyRound },
  { key: 'totpEnabled', label: '已开 2FA', icon: ShieldCheck },
  { key: 'platforms', label: '平台数', icon: Layers },
] as const;

/** 三列统计条：锁定页、后续的账号列表空态都可复用 */
export const VaultStatsRow = ({ stats }: { stats: VaultStatsType }) => (
  <dl className="grid grid-cols-3 gap-2">
    {STAT_ITEMS.map(({ key, label, icon: Icon }) => (
      <div key={key} className="bg-muted/60 flex flex-col items-center gap-1 rounded-lg px-2 py-3">
        <Icon className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        <dd className="text-lg leading-none font-semibold tabular-nums">{stats[key]}</dd>
        <dt className="text-muted-foreground text-xs">{label}</dt>
      </div>
    ))}
  </dl>
);
