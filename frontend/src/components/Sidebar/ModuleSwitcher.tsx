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
import { Bookmark, KeyRound, Lock, ServerCog, Sparkles } from 'lucide-react';
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

  // 账号库是独立路由：/accounts 列表页与 /accounts/:id 详情页都算账号库路由
  const isAccountsRoute = location.pathname.startsWith('/accounts');
  // 服务器监控同为独立路由（决策 D5）：/servers 列表页与 /servers/:id 详情页都算服务器路由
  const isServersRoute = location.pathname.startsWith('/servers');

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

    if (isAccountsRoute || isServersRoute) {
      // 从账号库 / 服务器返回列表页：不清标签筛选——URL 里的 tag 原样保留，回到列表即恢复原筛选。
      // 必须显式 navigate('/')：只 setModule 的话 URL 仍停在独立路由上，页面不会切换
      // （「从独立路由点侧栏模块无反应」正是漏了这一步）
      navigate('/');
    } else {
      setTagFilter(null);
    }

    if (isMobile) {
      toggleSidebar();
    }
  };

  // 任意路由下只高亮一个入口：账号库 / 服务器是独立路由，按路径判定（服务器行自己亮，
  // 三个模块行都不亮）；其余路由按 store.module。进入独立路由只 navigate、不改 store.module，
  // 因此从独立路由返回列表后原模块高亮自动恢复
  const activeKey: ModuleKey | null = isAccountsRoute ? MODULES.accounts.key : isServersRoute ? null : store.module;
  const isModuleActive = (key: ModuleKey) => key === activeKey;
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

          {/* 服务器监控（决策 D5）：独立路由 + 自建列表外壳，不进模块注册表 MODULE_KEYS，
              侧栏入口是独立行而非模块配置——图标 / label / 计数 / 点击 / 高亮与模块行同款，
              但不过 store.module（与账号库入口同款处理，这里复用同一渲染结构） */}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="服务器"
              onClick={() => {
                navigate('/servers');
                if (isMobile) {
                  toggleSidebar();
                }
              }}
              isActive={isServersRoute}
              className={'min-w-8 duration-200 ease-linear'}
            >
              <ServerCog />
              <span>服务器</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{store.servers.length}</SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});
