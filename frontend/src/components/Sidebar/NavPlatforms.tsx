import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';

import { SidebarMenu, useSidebar } from '@/components/ui/sidebar.tsx';
import { SidebarDotColorMenu } from '@/components/Sidebar/SidebarDotColorMenu.tsx';
import { SidebarFilterRow } from '@/components/Sidebar/SidebarFilterRow.tsx';
import { SidebarSection } from '@/components/Sidebar/SidebarSection.tsx';
import { MODULES } from '@/lib/modules.ts';
import { platformBrandColorClass } from '@/lib/accountFormat.ts';
import { sidebarDotColors } from '@/lib/sidebarDotColor.ts';
import { getColorClass } from '@/lib/utils.ts';
import { useAccountListState } from '@/hooks/useAccountListState.ts';
import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';

/**
 * 侧栏「平台」分区（PRD §5.1 / refinements.md §2.1~§2.3）。
 *
 * 只列平台标签 + 该平台账号数，按数量降序；不提供「全部账号 / 收藏 / 需要处理」
 * 等额外快捷视图（PRD §13），也不渲染「全部」行（O-14）：无平台筛选时列表无高亮，
 * 点击写入筛选、再点同一平台取消筛选。
 *
 * 计数从已加载账号数据派生，且锁定态也可见：账号列表接口返回的只是元数据与密文，
 * 平台名与条数不含任何账号内容（PRD §10.1）；锁定态点击筛选统一提示先解锁。
 *
 * 行内品牌色点只做视觉识别、不参与筛选；颜色取值统一走 accountFormat.platformBrandColorClass，
 * 与账号卡片品牌头像共用一份映射，这里不再写平台 → 颜色的 map。
 */
export const NavPlatforms = observer(() => {
  const store = React.useContext(StoreContext);
  const vault = React.useContext(VaultStoreContext);
  const { isMobile, toggleSidebar } = useSidebar();
  const { platform, togglePlatformFilter } = useAccountListState();

  const platformCounts = React.useMemo(() => {
    const counts = new Map<string, number>();

    for (const account of store.accounts) {
      const name = account.platform.trim();
      if (name === '') {
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return (
      [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        // 数量降序；同数量按平台名排序，保证每次渲染顺序稳定
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    );
  }, [store.accounts]);

  const selectPlatform = (name: string) => {
    if (!vault.unlocked) {
      // 锁定态不写 URL、不筛选：统一提示解锁（PRD §10.1）
      toast.error('请先解锁账号库', { position: 'top-center' });
      return;
    }

    togglePlatformFilter(name);

    if (isMobile) {
      toggleSidebar();
    }
  };

  // 账号库未初始化（refinements-v0.1.2 §4.3）：store.accounts 可能残留重置前的旧数据，
  // 必须优先展示提示，不能把历史平台当成可用筛选
  const isUninitialized = vault.initialized === false;

  return (
    <SidebarSection label={MODULES.accounts.sectionLabel}>
      {isUninitialized ? (
        <p className="text-muted-foreground px-2 text-xs">账号库尚未初始化</p>
      ) : platformCounts.length > 0 ? (
        <SidebarMenu>
          {platformCounts.map(({ name, count }) => {
            // 三点菜单里可把品牌色点改成调色板颜色（纯视觉偏好，存 localStorage）
            const override = sidebarDotColors.get('platform', name);

            return (
              <SidebarFilterRow
                key={name}
                label={name}
                count={count}
                dotClass={override ? getColorClass(override) : platformBrandColorClass(name)}
                isActive={platform === name}
                action={<SidebarDotColorMenu scope="platform" name={name} />}
                onClick={() => selectPlatform(name)}
              />
            );
          })}
        </SidebarMenu>
      ) : (
        <p className="text-muted-foreground px-2 text-xs">暂无账号</p>
      )}
    </SidebarSection>
  );
});
