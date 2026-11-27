/**
 * 待办展示格式化（PRD docs/prd/todo.md §5.3 / §5.4 / T12）。
 *
 * 时间列是服务端按 Asia/Shanghai 生成的 'Y-m-d H:i:s' 字符串：
 * - 行内时间直接截取前 16 位，不用 new Date() 解析后重新格式化，
 *   否则浏览器时区与服务端不同会把时间二次换算（dev-spec §3.3）；
 * - 「今天 / 昨天」分段同样固定按 Asia/Shanghai 计算日期，不依赖浏览器本地时区，
 *   与服务器生成日期的时间基准保持一致。
 */

export type TodoDayLabel = '今天' | '昨天' | '更早';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 服务端时间串的日期部分（'YYYY-MM-DD'）；格式不符时返回 null */
const dayKeyOf = (value: string | null | undefined): string | null => {
  const datePart = (value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
};

/** 按 Asia/Shanghai 取「N 天前」的日期键（中国无夏令时，直接按 24h 回溯即可） */
const dayKeyBefore = (days: number): string => dayFormatter.format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

/** 日期分段标题：今天 / 昨天 / 更早（列表布局按段分组，卡片布局不分段） */
export const getTodoDayLabel = (createdAt: string | null | undefined): TodoDayLabel => {
  const key = dayKeyOf(createdAt);
  if (key === null) {
    return '更早';
  }
  if (key === dayKeyBefore(0)) {
    return '今天';
  }
  if (key === dayKeyBefore(1)) {
    return '昨天';
  }
  return '更早';
};

/** 完整年月日 + 时分（T12：所有布局统一 'YYYY-MM-DD HH:mm'，不做分段省略） */
export const formatTodoTime = (createdAt: string | null | undefined): string => {
  const value = (createdAt ?? '').trim();
  return value.slice(0, 16);
};
