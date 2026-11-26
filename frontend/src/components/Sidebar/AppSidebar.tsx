import * as React from 'react';

import { ModuleSwitcher } from '@/components/Sidebar/ModuleSwitcher.tsx';
import { NavUser } from '@/components/Sidebar/NavUser.tsx';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
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
import { SidebarSection } from '@/components/Sidebar/SidebarSection.tsx';
import { SidebarFilterRow } from '@/components/Sidebar/SidebarFilterRow.tsx';
import { SidebarDotColorMenu } from '@/components/Sidebar/SidebarDotColorMenu.tsx';
import { getServerGroupDotClass, getServerGroupNames } from '@/lib/serverFormat.ts';
import { sidebarDotColors } from '@/lib/sidebarDotColor.ts';
import { getColorClass } from '@/lib/utils.ts';
import { ItemType, ServerGroupType, SkillType } from '@/lib/types.ts';

/**
 * 侧栏「服务器分组」分区（PRD §5.5 / 决策 D10 / refinements-v0.1.2 §3.1~§3.3）。
 *
 * 分组来自 server_groups 字典（不再固定四项）：优先用 store.serverGroupDict 的排序结果，
 * 字典未加载时回落列表接口的计数键（后端按字典输出全部名称，键集合一致），每项带计数。
 * 点击筛选、再点取消，不设「全部」行——无选中即全部。
 *
 * 计数取后端响应里的 store.serverGroups：按搜索命中全集统计、不受当前分组筛选影响，
 * 且为 0 的分组也返回（与账号库平台分区行为对齐）。
 * 选中态存 store.serverListParams.group（而非组件 state）：task11 列表页直接消费同一份
 * 参数，点击即按新条件重新拉取，侧栏与列表始终同源。
 *
 * 外壳与行规格复用 SidebarSection / SidebarFilterRow（§2.1 / §2.2）；本分区没有搜索动作，
 * 由 SidebarSection 渲染不可见占位，保证头部 2rem 与其他模块不跳动。
 */
const NavServerGroups = observer(() => {
  const store = React.useContext(StoreContext);
  const { isMobile, toggleSidebar } = useSidebar();

  const activeGroup = store.serverListParams.group ?? null;
  const groupNames =
    store.serverGroupDict.length > 0 ? getServerGroupNames(store.serverGroupDict) : Object.keys(store.serverGroups);

  const selectGroup = (group: ServerGroupType) => {
    // 再点一次当前分组即取消筛选（回落全量），与账号库平台筛选同款交互
    const next = activeGroup === group ? null : group;
    void store.fetchServers({ ...store.serverListParams, group: next });

    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <SidebarSection label="分组">
      <SidebarMenu>
        {groupNames.map((group) => {
          // 三点菜单里可把分组色点改成调色板颜色（纯视觉偏好，存 localStorage）
          const override = sidebarDotColors.get('group', group);

          return (
            <SidebarFilterRow
              key={group}
              label={group}
              count={store.serverGroups[group] ?? 0}
              dotClass={override ? getColorClass(override) : getServerGroupDotClass(group)}
              isActive={activeGroup === group}
              action={<SidebarDotColorMenu scope="group" name={group} />}
              onClick={() => selectGroup(group)}
            />
          );
        })}
      </SidebarMenu>
    </SidebarSection>
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
  // 同时拉分组字典，侧栏按 sort 顺序渲染、为 0 的分组也展示（refinements-v0.1.2 §3.3），
  // 沿用 store.serverListParams 里保留的筛选条件，离开再返回不丢失
  React.useEffect(() => {
    if (isServersRoute) {
      void store.fetchServerGroups();
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
