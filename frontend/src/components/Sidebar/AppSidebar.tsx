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
} from '@/components/ui/sidebar';
import { useLocation } from 'react-router-dom';

import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';
import { observer } from 'mobx-react-lite';
import { SettingsButton } from './SettingsButton.tsx';
import { Logo } from '@/components/Logo.tsx';
import { ThemeToggler } from '@/components/Sidebar/ThemeToggler.tsx';
import { NavTags } from '@/components/Sidebar/NavTags.tsx';
import { NavPlatforms } from '@/components/Sidebar/NavPlatforms.tsx';
import { ItemType, SkillType } from '@/lib/types.ts';

type AppSidebarProps = React.ComponentProps<typeof Sidebar>;

export const AppSidebar = observer(({ ...props }: AppSidebarProps) => {
  const store = React.useContext(StoreContext);
  const vault = React.useContext(VaultStoreContext);
  const location = useLocation();
  // 账号库是独立路由：在 /accounts 下侧栏分区切换为「平台」
  const isAccountsRoute = location.pathname.startsWith('/accounts');

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
        {isAccountsRoute ? <NavPlatforms /> : <NavTags itemIDsByTagID={itemIDsByTagID} />}
      </SidebarContent>
      {store.user && (
        <SidebarFooter>
          <NavUser username={store.user.username} />
        </SidebarFooter>
      )}
    </Sidebar>
  );
});
