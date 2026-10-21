import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar.tsx';
import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Bookmark, Sparkles } from 'lucide-react';
import { StoreContext } from '@/store/storeContext.ts';
import { useItemListState } from '@/hooks/useItemListState.ts';
import { MODULES, MODULE_KEYS } from '@/lib/modules.ts';
import { ModuleKey } from '@/lib/types.ts';

const MODULE_ICONS: Record<ModuleKey, React.ComponentType<{ className?: string }>> = {
  bookmarks: Bookmark,
  skills: Sparkles,
};

export const ModuleSwitcher = observer(() => {
  const store = React.useContext(StoreContext);
  const { isMobile, toggleSidebar } = useSidebar();
  const { setTagFilter } = useItemListState();

  const moduleCounts: Record<ModuleKey, number> = {
    bookmarks: store.items.length,
    skills: store.skills.length,
  };

  // 点当前模块等同于清除标签筛选；切到另一个模块时 store.setModule 会一并重置筛选与批量选择状态
  const selectModule = (key: ModuleKey) => {
    store.setModule(key);
    setTagFilter(null);
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-1">
        <SidebarMenu>
          {MODULE_KEYS.map((key) => {
            const Icon = MODULE_ICONS[key];

            return (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton
                  tooltip={MODULES[key].label}
                  onClick={() => selectModule(key)}
                  isActive={store.module === key}
                  className={'min-w-8 duration-200 ease-linear'}
                >
                  <Icon />
                  <span>{MODULES[key].label}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{moduleCounts[key]}</SidebarMenuBadge>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});
