import * as React from 'react';

import { ModuleSwitcher } from '@/components/Sidebar/ModuleSwitcher.tsx';
import { NavUser } from '@/components/Sidebar/NavUser.tsx';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useLocation } from 'react-router-dom';

import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';
import { observer } from 'mobx-react-lite';
import { SettingsButton } from './SettingsButton.tsx';
import { Logo } from '@/components/Logo.tsx';
import { ThemeToggler } from '@/components/Sidebar/ThemeToggler.tsx';
import { NavTags } from '@/components/Sidebar/NavTags.tsx';
import { NavPlatforms } from '@/components/Sidebar/NavPlatforms.tsx';
import { SERVER_GROUPS } from '@/lib/serverFormat.ts';
import { ItemType, ServerGroupType, SkillType } from '@/lib/types.ts';

/**
 * 侧栏「服务器分组」分区（PRD §5.5 / 决策 D10）。
 *
 * 分组固定四项（SERVER_GROUPS，与后端 ServerPayload::GROUPS 一致），每项带计数；
 * 点击筛选、再点取消，不设「全部」行——无选中即全部。
 *
 * 计数取后端响应里的 store.serverGroups：按搜索命中全集统计、不受当前分组筛选影响，
 * 且四项恒定返回（为 0 也展示，与账号库平台分区行为对齐）。
 * 选中态存 store.serverListParams.group（而非组件 state）：task11 列表页直接消费同一份
 * 参数，点击即按新条件重新拉取，侧栏与列表始终同源。
 */
const NavServerGroups = observer(() => {
  const store = React.useContext(StoreContext);
  const { isMobile, toggleSidebar } = useSidebar();

  const activeGroup = store.serverListParams.group ?? null;

  const selectGroup = (group: ServerGroupType) => {
    // 再点一次当前分组即取消筛选（回落全量），与账号库平台筛选同款交互
    const next = activeGroup === group ? null : group;
    void store.fetchServers({ ...store.serverListParams, group: next });

    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <SidebarGroup className="border-sidebar-border mt-1 gap-2 border-t">
      <div className="me-1 flex items-center justify-end gap-2">
        <SidebarGroupLabel className="me-auto">分组</SidebarGroupLabel>
      </div>

      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {SERVER_GROUPS.map((group) => (
            <SidebarMenuItem key={group}>
              <SidebarMenuButton
                onClick={() => selectGroup(group)}
                isActive={activeGroup === group}
                className="ps-8"
                title={group}
              >
                <span className="line-clamp-1 break-all">{group}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>{store.serverGroups[group] ?? 0}</SidebarMenuBadge>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});

type AppSidebarProps = React.ComponentProps<typeof Sidebar>;

export const AppSidebar = observer(({ ...props }: AppSidebarProps) => {
  const store = React.useContext(StoreContext);
  const vault = React.useContext(VaultStoreContext);
  const location = useLocation();
  // 账号库是独立路由：在 /accounts 下侧栏分区切换为「平台」
  const isAccountsRoute = location.pathname.startsWith('/accounts');
  // 服务器监控同为独立路由（决策 D5）：在 /servers 下侧栏分区切换为「分组」
  const isServersRoute = location.pathname.startsWith('/servers');

  // 侧栏模块计数需要 Skill 数据，书签列表页只加载 items/tags，这里补齐一次
  React.useEffect(() => {
    store.fetchSkills();
  }, [store]);

  // 平台计数只需要账号列表的元数据（平台名 + 条数），不解密任何字段，锁定态也加载（PRD §10.1）；
  // 账号库未初始化时接口返回 409，直接跳过
  React.useEffect(() => {
    if (isAccountsRoute && vault.initialized === true) {
      store.fetchAccounts();
    }
  }, [isAccountsRoute, vault.initialized, store]);

  // 服务器分组计数与列表数据：进入服务器路由时拉一次（与账号库平台计数同款处理）；
  // 沿用 store.serverListParams 里保留的筛选条件，离开再返回不丢失
  React.useEffect(() => {
    if (isServersRoute) {
      void store.fetchServers(store.serverListParams);
    }
  }, [isServersRoute, store]);

  const moduleItems: (ItemType | SkillType)[] = store.module === 'skills' ? store.skills : store.items;

  const itemIDsByTagID = moduleItems.reduce((acc: Record<number, number[]>, item) => {
    if (item.tags && item.tags.length > 0) {
      for (const tagID of item.tags) {
        acc[tagID] = acc[tagID] || [];
        acc[tagID].push(item.id);
      }
    } else {
      acc[0] = acc[0] || [];
      acc[0].push(item.id); // Count items without tags under key '0'
    }
    return acc;
  }, {});

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex w-full justify-between pl-2">
            <Logo />
            <div className="ml-auto flex items-center gap-0.5">
              <ThemeToggler />
              <SettingsButton />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="no-scrollbar gap-0">
        <ModuleSwitcher />
        {isAccountsRoute ? (
          <NavPlatforms />
        ) : isServersRoute ? (
          <NavServerGroups />
        ) : (
          <NavTags itemIDsByTagID={itemIDsByTagID} />
        )}
      </SidebarContent>
      {store.user && (
        <SidebarFooter>
          <NavUser username={store.user.username} />
        </SidebarFooter>
      )}
    </Sidebar>
  );
});
