/**
 * 服务器监控的展示常量与纯格式化 helper（PRD docs/prd/server.md §5.1 / §5.5 / §6）。
 *
 * 只放「枚举 → 展示」的常量与「数据 → 展示文本」的纯函数，组件不直接写底层逻辑
 * （与 accountFormat.ts 同一分工）。
 *
 * 单位口径：接口返回一律是库内原始单位（字节 / 字节每秒 / 百分比 / 秒），
 * KB / MB / GB 之类的换算只发生在本文件，组件拿到的都是展示文本。
 */

import { formatRelativePast } from '@/lib/accountFormat.ts';
import type {
  ServerGroupType,
  ServerOrderType,
  ServerRangeType,
  ServerSortType,
  ServerStatusType,
} from '@/lib/types.ts';

/** 分组白名单固定四项（后端 ServerPayload::GROUPS，决策 D10）；数组顺序即侧栏展示顺序 */
export const SERVER_GROUPS: ServerGroupType[] = ['家庭', '公网', '公司', '归档'];

/** 默认分组：新增弹窗预选与后端建表默认值一致（PRD §5.1） */
export const SERVER_DEFAULT_GROUP: ServerGroupType = '家庭';

/**
 * 连接状态四态展示（PRD §5.1 卡片状态点 / 详情页徽章）。
 * dot 为状态点颜色类、text 为文字色类：只用 Tailwind 语义调色板类并带 dark: 变体，
 * 不写死十六进制颜色（暗色主题必须可用，与 AccountBadges 等同款写法）。
 */
export const SERVER_STATUS: Record<ServerStatusType, { label: string; dot: string; text: string }> = {
  online: {
    label: '在线',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-300',
  },
  offline: {
    label: '离线',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
  },
  paused: {
    label: '已暂停',
    dot: 'bg-neutral-400 dark:bg-neutral-500',
    text: 'text-neutral-500 dark:text-neutral-400',
  },
  pending: {
    label: '等待连接',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
  },
};

/**
 * 状态排序权重（PRD §5.5「在线优先」，与后端 statusRank 一致）：
 * 在线排最前，其次离线（有异常需关注），再等待连接，最后已暂停。
 * 客户端筛选排序（mainStore.filterServers）按数组下标比较。
 */
export const SERVER_STATUS_ORDER: ServerStatusType[] = ['online', 'offline', 'pending', 'paused'];

/**
 * 历史指标范围档位（PRD §5.5 图表区范围切换 / §6 接口白名单）。
 * 前三档为明细序列，30d 由服务端按小时聚合（决策 D4：不建聚合表），字段同构。
 */
export const SERVER_RANGES: { value: ServerRangeType; label: string }[] = [
  { value: '1h', label: '1 小时' },
  { value: '6h', label: '6 小时' },
  { value: '24h', label: '24 小时' },
  { value: '30d', label: '30 天' },
];

/** 图表默认范围：详情页打开即展示近 6 小时（PRD §5.5） */
export const SERVER_DEFAULT_RANGE: ServerRangeType = '6h';

/** 后端排序键白名单（ServersGetController::SORT_KEYS），白名单外回落 id */
const SERVER_SORT_KEYS: ServerSortType[] = [
  'id',
  'name',
  'group',
  'status',
  'cpu',
  'mem',
  'last_report_at',
  'created_at',
  'updated_at',
];

/**
 * 列表排序选项（PRD §5.5：状态 / 名称 / CPU / 内存）。
 * value 为「字段-方向」合一写法（mockups SERVER_SORTS 形态），后端 parseSort 直接识别，
 * 也可经 parseServerSort 拆成 sort + order；状态的缺省方向为 asc（在线优先），
 * 其余 desc，与后端缺省方向一致。
 */
export const SERVER_SORTS: { value: string; label: string }[] = [
  { value: 'status-asc', label: '状态' },
  { value: 'name-asc', label: '名称' },
  { value: 'cpu-desc', label: 'CPU 使用率' },
  { value: 'mem-desc', label: '内存' },
];

/**
 * 解析「字段-方向」合一写法（如 cpu-desc）为后端 / store 接受的 sort + order。
 * 口径与后端 parseSort 对齐：白名单外回落 id/desc，无方向后缀时按字段取缺省方向。
 */
export const parseServerSort = (value: string): { sort: ServerSortType; order: ServerOrderType } => {
  const matched = /^(.+)-(asc|desc)$/.exec(value.trim());
  const sort = (matched ? matched[1] : value.trim()) as ServerSortType;
  const order = (matched ? matched[2] : sort === 'status' ? 'asc' : 'desc') as ServerOrderType;

  if (!SERVER_SORT_KEYS.includes(sort)) {
    return { sort: 'id', order: 'desc' };
  }

  return { sort, order };
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * 字节数按 1024 进位换算（速率与容量共用一套进位口径，禁止复制两份实现）。
 * 小于 1KB 取整到 B，其余保留 1 位小数；非有限值 / 负数按 0 处理（后端已做
 * 非负校验，这里只是兜底，避免展示出「NaN KB」）。
 */
const formatScaledBytes = (bytes: number, unitSuffix: string): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return `0 ${BYTE_UNITS[0]}${unitSuffix}`;
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} ${BYTE_UNITS[0]}${unitSuffix}`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${BYTE_UNITS[unitIndex]}${unitSuffix}`;
};

/**
 * 速率格式化（字节每秒 → B/s / KB/s / MB/s / GB/s）。
 * 个人服务器网络量级通常在 KB/s ~ MB/s，保留 1 位小数（PRD §5.1 网络行）。
 */
export const formatServerRate = (bytesPerSecond: number): string => formatScaledBytes(bytesPerSecond, '/s');

/**
 * 容量格式化（字节 → B / KB / MB / GB / TB）。
 * 磁盘与内存用量统一走这里（PRD §5.1 meter 行 / §5.5 磁盘区），GB 量级自然落在 GB。
 */
export const formatServerBytes = (bytes: number): string => formatScaledBytes(bytes, '');

/**
 * 开机时长格式化（秒 → 「N 天 N 小时」/「N 小时 N 分」/「N 分钟」）。
 * 只取两个最有信息量的单位；不足 1 分钟展示「不到 1 分钟」。
 */
export const formatServerUptime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—';
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }

  return minutes > 0 ? `${minutes} 分钟` : '不到 1 分钟';
};

/**
 * 最后回传相对时间（PRD §5.1 卡片页脚 / §5.5 详情页）。
 * 复用账号库的 formatRelativePast——同一套「N 分钟前」粗粒度口径，不复制两份实现；
 * 服务器特有的语义：从未回传（pending，last_report_at 为 null）展示「从未回传」。
 */
export const formatServerLastReport = (value: string | null | undefined): string =>
  formatRelativePast(value) ?? '从未回传';

/**
 * 百分比取整（CPU / 内存 / 磁盘用量统一口径，PRD §5.1 meter 行 / §5.5 磁盘区）。
 * 后端已做范围校验（CPU 0–100、内存不大于总量），这里只负责取整展示；
 * 磁盘用量由调用方按 used / total × 100 换算后传入。
 */
export const formatServerPercent = (value: number): string => `${Math.max(0, Math.round(value))}%`;
