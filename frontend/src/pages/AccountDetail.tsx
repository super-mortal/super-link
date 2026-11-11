import { useCallback, useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { AccountDetailHeader } from '@/components/Account/AccountDetailHeader.tsx';
import { AccountCredentials } from '@/components/Account/AccountCredentials.tsx';
import { AccountNotesCard } from '@/components/Account/AccountNotesCard.tsx';
import { AuthorizationList } from '@/components/Account/AuthorizationList.tsx';
import { AccountInfoPanel } from '@/components/Account/AccountInfoPanel.tsx';
import { notifyAccountDialogPending } from '@/components/Account/accountMessages.ts';
import { useAccountSecretDecrypt } from '@/hooks/useAccountSecretDecrypt.ts';
import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';
import Loading from '@/layouts/Loading.tsx';
import type { AccountDetailType } from '@/lib/types.ts';

/**
 * `/accounts/:accountID` 账号详情页（PRD §5.2 / §10.4）。
 *
 * 结构：头部（徽章 + 操作）→ 主内容两栏（凭据 / 授权关系 / 备注 + 右栏基本信息 / 账号状态），
 * ≥1024px 主栏 2fr + 侧栏 1fr，<1024px 单列（PRD §10.7）。
 *
 * 解锁与加载顺序（task8 观察项）：**锁定态不拉详情**——密文接口在锁定态没有意义，
 * 且重定向回 `/accounts` 前多发一次请求会暴露「用户看过哪个账号」的时序信息，
 * 因此 fetch 放在解锁判断之后；自动锁定触发时同样直接重定向，不渲染任何明文。
 * 解密不经过 MobX：明文只经 useAccountSecretDecrypt 的组件 state 与 vaultSession 内存缓存流转。
 */
export const AccountDetail = observer(() => {
  const store = useContext(StoreContext);
  const vault = useContext(VaultStoreContext);
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const accountID = Number(params.accountID);
  const validID = Number.isInteger(accountID) && accountID > 0;

  const [detail, setDetail] = useState<AccountDetailType | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  /** 拉取详情（元数据 + 密文 + 授权关系）；解密发生在组件内按需进行，store 只搬运密文 */
  const loadDetail = useCallback(async () => {
    if (!validID) {
      return;
    }

    const result = await store.fetchAccountDetail(accountID);
    setDetail(result);
    setLoadFailed(result === null);
  }, [store, accountID, validID]);

  // 解锁判断放在 fetch 之前：锁定态（含自动锁定回落）一律不请求详情接口
  useEffect(() => {
    if (!vault.unlocked) {
      return;
    }
    void loadDetail();
  }, [loadDetail, vault.unlocked]);

  // 详情未加载时 id 传 0：此时所有解密入口都不会被渲染触发，仅占位保持 hook 顺序稳定
  const secretActions = useAccountSecretDecrypt(detail?.id ?? 0, detail?.secrets);

  const handleDelete = useCallback(async () => {
    if (!detail) {
      return;
    }
    const ok = await store.deleteAccounts([detail.id]);
    if (ok) {
      navigate('/accounts');
    }
  }, [detail, store, navigate]);

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

        {!validID || (loadFailed && !detail) ? (
          <Card className="max-w-md">
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <p className="text-muted-foreground text-sm">{validID ? '账号不存在或加载失败' : '账号 ID 无效'}</p>
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft />
                返回账号库
              </Button>
            </CardContent>
          </Card>
        ) : !detail ? (
          <Loading />
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            <AccountDetailHeader
              account={detail}
              onCopyPassword={secretActions.copyPassword}
              onRefresh={loadDetail}
              onEdit={notifyAccountDialogPending}
              onLock={() => vault.lock()}
              onDelete={handleDelete}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="flex flex-col gap-4 lg:col-span-2">
                <AccountCredentials account={detail} secretActions={secretActions} />
                <AuthorizationList
                  authorizations={detail.authorizations}
                  accountId={detail.id}
                  onRefresh={loadDetail}
                />
                <AccountNotesCard
                  notes={secretActions.notes}
                  pending={secretActions.notesPending}
                  error={secretActions.notesError}
                  loadNotes={secretActions.loadNotes}
                />
              </div>
              <AccountInfoPanel account={detail} />
            </div>
          </div>
        )}
      </div>
    </Dashboard>
  );
});
