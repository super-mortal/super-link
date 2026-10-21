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

import { StoreContext } from '@/store/storeContext.ts';
import { observer } from 'mobx-react-lite';
import { SettingsButton } from './SettingsButton.tsx';
import { Logo } from '@/components/Logo.tsx';
import { ThemeToggler } from '@/components/Sidebar/ThemeToggler.tsx';
import { NavTags } from '@/components/Sidebar/NavTags.tsx';
import { ItemType, SkillType } from '@/lib/types.ts';

type AppSidebarProps = React.ComponentProps<typeof Sidebar>;

export const AppSidebar = observer(({ ...props }: AppSidebarProps) => {
  const store = React.useContext(StoreContext);

  // 侧栏模块计数需要 Skill 数据，书签列表页只加载 items/tags，这里补齐一次
  React.useEffect(() => {
    store.fetchSkills();
  }, [store]);

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
        <NavTags itemIDsByTagID={itemIDsByTagID} />
      </SidebarContent>
      {store.user && (
        <SidebarFooter>
          <NavUser username={store.user.username} />
        </SidebarFooter>
      )}
    </Sidebar>
  );
});
