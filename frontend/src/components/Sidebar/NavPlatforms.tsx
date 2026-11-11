import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar.tsx';
import { MODULES } from '@/lib/modules.ts';
import { useAccountListState } from '@/hooks/useAccountListState.ts';
import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';

/**
 * 侧栏「平台」分区（PRD §5.1）。
 *
 * 只列平台标签 + 该平台账号数，按数量降序；不提供「全部账号 / 收藏 / 需要处理」
 * 等额外快捷视图（PRD §13）。点击进入筛选，再点一次取消。
 *
 * 计数从已加载账号数据派生，且锁定态也可见：账号列表接口返回的只是元数据与密文，
 * 平台名与条数不含任何账号内容（PRD §10.1）；锁定态点击筛选统一提示先解锁。
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

  return (
    <SidebarGroup className="gap-2">
      <div className="me-1 flex items-center justify-end gap-2">
        <SidebarGroupLabel className="me-auto">{MODULES.accounts.sectionLabel}</SidebarGroupLabel>
      </div>

      <SidebarGroupContent className="flex flex-col gap-2">
        {platformCounts.length > 0 ? (
          <SidebarMenu>
            {platformCounts.map(({ name, count }) => (
              <SidebarMenuItem key={name}>
                <SidebarMenuButton
                  onClick={() => selectPlatform(name)}
                  isActive={platform === name}
                  className="ps-8"
                  title={name}
                >
                  <span className="line-clamp-1 break-all">{name}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{count}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        ) : (
          <p className="text-muted-foreground px-2 text-xs">暂无账号</p>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
});
