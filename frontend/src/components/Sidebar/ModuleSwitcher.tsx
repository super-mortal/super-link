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
import { Bookmark, KeyRound, Lock, Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';
import { useItemListState } from '@/hooks/useItemListState.ts';
import { MODULES, MODULE_KEYS } from '@/lib/modules.ts';
import { ModuleKey } from '@/lib/types.ts';

const MODULE_ICONS: Record<ModuleKey, React.ComponentType<{ className?: string }>> = {
  bookmarks: Bookmark,
  skills: Sparkles,
  // PRD §5.1：账号库模块图标为 KeyRound
  accounts: KeyRound,
};

export const ModuleSwitcher = observer(() => {
  const store = React.useContext(StoreContext);
  const vault = React.useContext(VaultStoreContext);
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile, toggleSidebar } = useSidebar();
  const { setTagFilter } = useItemListState();

  // 账号库是独立路由，高亮按路径判断；书签 / Skill 仍看 store.module
  const isAccountsRoute = location.pathname.startsWith('/accounts');

  const moduleCounts: Record<ModuleKey, number> = {
    bookmarks: store.items.length,
    skills: store.skills.length,
    accounts: store.accounts.length,
  };

  // 点当前模块等同于清除标签筛选；切到另一个模块时 store.setModule 会一并重置筛选与批量选择状态
  const selectModule = (key: ModuleKey) => {
    // 账号库需要解锁、且是独立路由：点它跳 /accounts，不走 store.module
    // （ModuleList 的表格与三种布局暂不支持 accounts，后续任务接入）
    if (key === 'accounts') {
      navigate('/accounts');
      return;
    }

    store.setModule(key);

    if (isAccountsRoute) {
      // 从账号库返回列表页：不清标签筛选——URL 里的 tag 原样保留，回到列表即恢复原筛选
      navigate('/');
    } else {
      setTagFilter(null);
    }

    if (isMobile) {
      toggleSidebar();
    }
  };

  const isModuleActive = (key: ModuleKey) => (key === 'accounts' ? isAccountsRoute : store.module === key);
  // 已初始化但锁定时在模块行标锁（PRD §5.1）；未初始化时不标——首次进入应看到「设置主密码」
  const showVaultLock = vault.initialized === true && !vault.unlocked;

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
                  isActive={isModuleActive(key)}
                  className={'min-w-8 duration-200 ease-linear'}
                >
                  <Icon />
                  <span>{MODULES[key].label}</span>
                  {key === 'accounts' && showVaultLock && <Lock className="ms-auto h-3 w-3 opacity-70" />}
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
