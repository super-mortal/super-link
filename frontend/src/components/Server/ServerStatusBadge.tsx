import { cn } from '@/lib/utils.ts';
import { SERVER_STATUS } from '@/lib/serverFormat.ts';
import type { ServerStatusType } from '@/lib/types.ts';

/**
 * 徽章浅底色（原型 .srv-status.st-*：状态色 14% 透明度底，亮/暗双主题；
 * 已暂停用 secondary 中性底，不掺状态色）。颜色色相与 SERVER_STATUS 的 text/dot 对齐，
 * 不另立一套状态色——状态语义只有 serverFormat 那一份。
 */
const STATUS_BADGE_BG: Record<ServerStatusType, string> = {
  online: 'bg-green-500/15',
  offline: 'bg-destructive/12',
  paused: 'bg-secondary',
  pending: 'bg-amber-500/15',
};

type ServerStatusBadgeProps = {
  status: ServerStatusType;
  /** 详情页头部用大号（原型 statusBadgeHtml(s, true)），其余场景用默认小号 */
  size?: 'sm' | 'lg';
};

/**
 * 连接状态徽章（PRD §5.1 / §5.5）：四态（在线 / 离线 / 已暂停 / 等待连接）。
 * 列表卡片头部只用状态点（ServerCard），文字状态徽章在详情页头部展示。
 */
export const ServerStatusBadge = ({ status, size = 'sm' }: ServerStatusBadgeProps) => {
  const meta = SERVER_STATUS[status];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded font-medium whitespace-nowrap',
        size === 'lg' ? 'px-2 py-1 text-[13px]' : 'px-1.5 py-0.5 text-xs',
        meta.text,
        STATUS_BADGE_BG[status]
      )}
    >
      <span className={cn('rounded-full', size === 'lg' ? 'size-2' : 'size-1.5', meta.dot)} />
      {meta.label}
    </span>
  );
};
