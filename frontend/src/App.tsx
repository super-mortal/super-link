import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { useContext, useEffect } from 'react';
import { StoreContext, VaultStoreContext } from './store/storeContext';
import { Login } from './pages/Login.tsx';
import { Setup } from './pages/Setup.tsx';
import { SetupAuth } from './pages/SetupAuth.tsx';
import { SetupImport } from './pages/SetupImport.tsx';
import { SetupIntegrations } from './pages/SetupIntegrations.tsx';
import { Toaster } from './components/ui/sonner';
import { NotFound } from './layouts/NotFound.tsx';
import { RouterProvider } from 'react-router';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Button } from '@/components/ui/button.tsx';
import { ModuleList } from '@/pages/ModuleList.tsx';
import { CreateItem } from '@/pages/CreateItem.tsx';
import { EditItem } from '@/pages/EditItem.tsx';
import { SkillDetail } from '@/pages/SkillDetail.tsx';
import { AccountVault } from '@/pages/AccountVault.tsx';
import { AccountDetail } from '@/pages/AccountDetail.tsx';

const InitMiddleware = observer(() => {
  const store = useContext(StoreContext);

  useEffect(() => {
    // If request was successful even with no user data, it means that setup and auth are not required, so we can set them to false
    const loadData = async () => {
      const response = await store.getUser(true);
      if (response !== null) {
        store.setIsSetupRequired(false);
        store.setIsAuthRequired(false);
      }
    };
    loadData();
  }, [store]);

  if (store.isSetupRequired === null || store.isAuthRequired === null) {
    return (
      <div className="bg-background flex h-full min-h-screen w-full flex-col items-center justify-center">
        <Spinner className="h-10 w-10" />
      </div>
    );
  }

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
});

const AuthMiddleware = observer(() => {
  const store = useContext(StoreContext);
  const location = useLocation();

  if (store.isAuthRequired) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
});

const SetupMiddleware = observer(() => {
  const store = useContext(StoreContext);

  // If we are not on the setup page while DB is not initialized, redirect to setup
  if (store.isSetupRequired) {
    return <Navigate to="/setup" replace />;
  }

  // Otherwise continue
  return <Outlet />;
});

/**
 * 账号库路由守卫：进入时拉一次元信息（决定锁定页展示「设置主密码」还是「账号库已锁定」）。
 * 锁定 / 未初始化形态由 AccountVault 自己渲染——锁定态也要保留侧栏（平台计数）与
 * 工具栏（PRD §5.3 / §10.1），所以这里只做元信息加载，不提前拦截。
 */
const VaultGuard = observer(() => {
  const vault = useContext(VaultStoreContext);

  useEffect(() => {
    // 进入路由时拉一次元信息：决定展示「设置主密码」还是「账号库已锁定」
    void vault.loadMeta();
  }, [vault]);

  if (vault.initialized === null) {
    if (vault.metaLoadFailed) {
      return (
        <div className="bg-background flex min-h-screen w-full flex-col items-center justify-center gap-4 p-4">
          <p className="text-muted-foreground text-sm">无法读取账号库状态，请检查网络后重试。</p>
          <Button variant="outline" onClick={() => void vault.loadMeta()}>
            重试
          </Button>
        </div>
      );
    }

    return (
      <div className="bg-background flex h-full min-h-screen w-full flex-col items-center justify-center">
        <Spinner className="h-10 w-10" />
      </div>
    );
  }

  return <Outlet />;
});

const router = createBrowserRouter([
  {
    element: <InitMiddleware />,
    children: [
      {
        element: <SetupMiddleware />,
        children: [
          { path: '/login', element: <Login /> },
          {
            element: <AuthMiddleware />,
            children: [
              { path: '/', element: <ModuleList /> },
              { path: '/setup/auth', element: <SetupAuth /> },
              { path: '/setup/import', element: <SetupImport /> },
              { path: '/setup/integrations', element: <SetupIntegrations /> },
              { path: '/create-item', element: <CreateItem /> },
              { path: '/edit-item/:itemID', element: <EditItem /> },
              { path: '/skills/:skillID', element: <SkillDetail /> },
              {
                // 账号库：VaultGuard 只负责拉取元信息，锁定 / 解锁形态由页面自己决定
                // （锁定态也保留侧栏与工具栏；详情页未解锁时重定向回 /accounts）
                element: <VaultGuard />,
                children: [
                  { path: '/accounts', element: <AccountVault /> },
                  { path: '/accounts/:accountID', element: <AccountDetail /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '/setup', element: <Setup />, id: 'setup' },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export const App = () => {
  return <RouterProvider router={router} />;
};
