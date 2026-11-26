import { useUrlState } from '@/hooks/useUrlState.ts';

/**
 * 账号库列表的 URL 状态（PRD §9.6）。
 *
 * 在 `useUrlState` 基础上新增 `platform` 参数（平台标签名，精确筛选）。
 *
 * `page` / `per-page` / `sort` / `order` / `search` 继续复用同一套参数。
 * 分组筛选入口已移除（refinements-v0.1.2 §4.5）：分组只在「设置 → 分组」维护、
 * 在卡片徽章行展示，因此这里不再读写 `group` URL 参数（后端
 * `GET /api/accounts?group=` 参数保留，界面不再有入口）。
 * 账号库**不写入** `tag`：它不使用书签 / Skill 的标签体系（PRD §5.1.1）。
 * URL 是筛选条件的唯一来源，组件不各自存一份筛选状态。
 */
export const useAccountListState = () => {
  const { searchParams, setUrlState } = useUrlState();

  const platform = searchParams.get('platform');

  const setPlatformFilter = (value: string | null) => {
    setUrlState({
      platform: value,
      // 换筛选条件回到第 1 页，否则可能停在不存在的页码上
      page: 1,
    });
  };

  /** 侧栏平台标签：点未选中的平台进入筛选，再点一次取消（PRD §5.1） */
  const togglePlatformFilter = (value: string) => {
    setPlatformFilter(platform === value ? null : value);
  };

  return { platform, setPlatformFilter, togglePlatformFilter };
};
