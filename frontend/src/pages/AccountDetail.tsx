import { useCallback, useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';
import type { AccountDetailType } from '@/lib/types.ts';

/**
 * `/accounts/:accountID` 账号详情占位页（PRD §5.2）。
 *
 * 详情本体（凭据 / 授权关系 / 备注 / 账号状态，PRD §10.4）在后续任务接入，
 * 这里先落地最小可用结构：未解锁重定向回 `/accounts`、已解锁时展示账号 id、
 * 返回按钮，并预留 `fetchAccountDetail` 的调用位置——数据链路已由 mainStore 提供，
 * 后续只需把 detail 渲染成正式布局，不需要再改调用方式。
 */
export const AccountDetail = observer(() => {
  const store = useContext(StoreContext);
  const vault = useContext(VaultStoreContext);
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const accountID = Number(params.accountID);

  const [detail, setDetail] = useState<AccountDetailType | null>(null);

  /** 拉取详情（元数据 + 密文 + 授权关系）；解密发生在调用方，不在本页做任何处理 */
  const loadDetail = useCallback(async () => {
    if (!Number.isInteger(accountID) || accountID <= 0) {
      return;
    }

    const result = await store.fetchAccountDetail(accountID);
    setDetail(result);
  }, [store, accountID]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  // 直接进入详情（非列表跳转）时没有历史记录，退回账号库列表
  const goBack = () => {
    if (location.key === 'default') {
      navigate('/accounts');
      return;
    }
    navigate(-1);
  };

  // 未解锁一律回列表锁定页：不渲染任何账号内容（PRD §5.2 / §10.1）
  if (!vault.unlocked) {
    return <Navigate to="/accounts" replace />;
  }

  return (
    <Dashboard>
      <div className="h-full overflow-y-auto p-5">
        <div className="mb-4 flex items-center gap-2">
          <SidebarToggler />
          <button
            type="button"
            onClick={goBack}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[13px] transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            返回账号库
          </button>
        </div>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-xl">账号详情占位</CardTitle>
            <CardDescription>
              账号 ID：{Number.isInteger(accountID) && accountID > 0 ? accountID : '无效'}
              {detail ? `（${detail.name}）` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
              凭据、授权关系、备注与账号状态会在后续任务接入，这里先保留占位容器。
            </div>
            <Button variant="outline" className="self-start" onClick={goBack}>
              <ArrowLeft />
              返回账号库
            </Button>
          </CardContent>
        </Card>
      </div>
    </Dashboard>
  );
});
