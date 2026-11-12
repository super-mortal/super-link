import { SidebarProvider } from '@/components/ui/sidebar.tsx';
import React, { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '@/store/storeContext.ts';
import { AppSidebar } from '@/components/Sidebar/AppSidebar.tsx';
import { SettingsDialog } from '../components/Settings/SettingsDialog.tsx';
import { EditItemDialog } from '@/components/EditItem/EditItemDialog.tsx';
import { ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useDefaultLayout, usePanelCallbackRef, type Layout } from 'react-resizable-panels';
import { useIsMobile } from '@/hooks/use-mobile.ts';
import { SidebarPanelContext } from '@/contexts/SidebarPanelContext.ts';

export const Dashboard = observer(({ children }: { children: React.ReactNode }) => {
  const store = useContext(StoreContext);

  const isMobile = useIsMobile();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'dashboard-layout',
  });
  const [panelRef, setPanelRef] = usePanelCallbackRef();

  // O-3 桌面端侧栏折叠/展开动效：react-resizable-panels 以内联 flex-grow 表达面板宽度，
  // 过渡窗口只在「折叠状态发生变化」时开启，具体过渡规则见 index.css 的 data-sidebar-animating。
  // 窗口缩放同样会重算各面板 flex-grow，但不改变折叠状态，不进窗口，避免布局跟随出现拖影
  const [sidebarAnimating, setSidebarAnimating] = React.useState(false);
  const sidebarAnimTimer = React.useRef(0);
  const wasSidebarCollapsed = React.useRef(false);

  // 卸载时清掉未触发的定时器，避免对已卸载组件 setState
  React.useEffect(() => () => window.clearTimeout(sidebarAnimTimer.current), []);

  const handleLayoutChanged = (layout: Layout) => {
    onLayoutChanged(layout);

    // panelRef 在面板挂载后才可用；isCollapsed() 读取的是库的实时布局状态
    const collapsed = panelRef?.isCollapsed() ?? false;
    if (collapsed !== wasSidebarCollapsed.current) {
      wasSidebarCollapsed.current = collapsed;
      // 每次切换重启 250ms 窗口（略长于 200ms 过渡）：连续快速点击时窗口不会提前关闭，
      // 最后一次过渡结束后才移除过渡属性，避免动画中途被切断导致跳变
      window.clearTimeout(sidebarAnimTimer.current);
      sidebarAnimTimer.current = window.setTimeout(() => setSidebarAnimating(false), 250);
      setSidebarAnimating(true);
    }
  };

  const contextValue = React.useMemo(() => ({ panelRef }), [panelRef]);

  return (
    <>
      <SidebarPanelContext.Provider value={contextValue}>
        <SidebarProvider
          style={
            {
              '--sidebar-width': '100%',
            } as React.CSSProperties
          }
        >
          <ResizablePanelGroup
            orientation="horizontal"
            className="fixed inset-0"
            defaultLayout={defaultLayout}
            onLayoutChanged={handleLayoutChanged}
            data-sidebar-animating={sidebarAnimating}
          >
            {isMobile ? (
              <AppSidebar />
            ) : (
              <ResizablePanel
                minSize="280px"
                maxSize="40%"
                defaultSize="340px"
                collapsible={true}
                groupResizeBehavior="preserve-pixel-size"
                panelRef={setPanelRef}
              >
                <AppSidebar />
              </ResizablePanel>
            )}
            <ResizablePanel>
              <main className="@container/main h-full">{children}</main>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarProvider>
        {store.isItemModalOpen && <EditItemDialog />}
        {store.isSettingsModalOpen && <SettingsDialog />}
      </SidebarPanelContext.Provider>
    </>
  );
});
