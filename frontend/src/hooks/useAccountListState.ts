import { useUrlState } from '@/hooks/useUrlState.ts';

/**
 * 账号库列表的 URL 状态（PRD §9.6）。
 *
 * 在 `useUrlState` 基础上新增两个参数：
 * - `platform`：平台标签名（精确筛选）；
 * - `group`：分组 id。
 *
 * `page` / `per-page` / `sort` / `order` / `search` 继续复用同一套参数。
 * 账号库**不写入** `tag`：它不使用书签 / Skill 的标签体系（PRD §5.1.1）。
 * URL 是筛选条件的唯一来源，组件不各自存一份筛选状态。
 */
export const useAccountListState = () => {
  const { searchParams, setUrlState } = useUrlState();

  const platform = searchParams.get('platform');
  const rawGroup = searchParams.get('group');
  // group 只认正整数：URL 里手写的非法值按「不筛选」处理，与后端 (int) 强转的宽松行为对齐
  const group = rawGroup !== null && /^\d+$/.test(rawGroup) && Number(rawGroup) > 0 ? Number(rawGroup) : null;

  const setPlatformFilter = (value: string | null) => {
    setUrlState({
      platform: value,
      // 换筛选条件回到第 1 页，否则可能停在不存在的页码上
      page: 1,
    });
  };

  const setGroupFilter = (value: number | null) => {
    setUrlState({
      group: value,
      page: 1,
    });
  };

  /** 侧栏平台标签：点未选中的平台进入筛选，再点一次取消（PRD §5.1） */
  const togglePlatformFilter = (value: string) => {
    setPlatformFilter(platform === value ? null : value);
  };

  return { platform, group, setPlatformFilter, setGroupFilter, togglePlatformFilter };
};
