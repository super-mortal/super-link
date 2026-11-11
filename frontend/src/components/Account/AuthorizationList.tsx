import { useCallback, useContext, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { AuthorizationCard } from '@/components/Account/AuthorizationCard.tsx';
import { AuthorizationDetailDialog } from '@/components/Account/AuthorizationDetailDialog.tsx';
import { AuthorizationFormDialog } from '@/components/Account/AuthorizationFormDialog.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import type { AccountAuthorizationType } from '@/lib/types.ts';

type AuthorizationListProps = {
  authorizations: AccountAuthorizationType[];
  /** 来源账号 id：关联账号下拉排除自身；写操作后按它重新拉取详情 */
  accountId: number;
  /** 写操作成功后重新拉取账号详情：授权数据只存在于详情里，store 不维护副本 */
  onRefresh: () => void | Promise<void>;
};

/**
 * 授权关系区（PRD §10.4 / §10.5）：数量 + 筛选 + 双列紧凑卡片 + 详情 / 新增 / 移除弹窗。
 *
 * 数据全部来自详情接口的 `authorizations`，本组件不持有副本；所有写操作成功后统一
 * 回调 `onRefresh` 由详情页重新拉取，避免与父级的状态出现两份真相。
 */
export const AuthorizationList = observer(({ authorizations, accountId, onRefresh }: AuthorizationListProps) => {
  const store = useContext(StoreContext);
  const navigate = useNavigate();

  const [filter, setFilter] = useState('');
  /** 详情弹窗按 id 派生：授权被删后 find 返回 null，弹窗随之自动关闭 */
  const [detailTargetID, setDetailTargetID] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /** null = 新增模式，传值 = 编辑该行（PRD §10.3） */
  const [formTarget, setFormTarget] = useState<AccountAuthorizationType | null>(null);

  // 关联账号名从已加载的列表元数据里查（侧栏平台计数本来就持有全量账号，不解密任何字段）；
  // 找不到 = 账号已被删除，只提示不跳转
  const accountNameByID = useMemo(() => new Map(store.accounts.map((item) => [item.id, item.name])), [store.accounts]);
  const linkedNameOf = (id: number | null | undefined) => (id ? (accountNameByID.get(id) ?? null) : null);

  const detailTarget = useMemo(
    () => authorizations.find((item) => item.id === detailTargetID) ?? null,
    [authorizations, detailTargetID]
  );

  // 前端补充筛选：授权备注不在服务端搜索范围（PRD §9.5），这里按已加载数据本地过滤
  const filtered = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) {
      return authorizations;
    }
    return authorizations.filter((item) => {
      const linkedName = item.linked_account_id ? (accountNameByID.get(item.linked_account_id) ?? '') : '';
      return (
        item.service.toLowerCase().includes(keyword) ||
        (item.identifier ?? '').toLowerCase().includes(keyword) ||
        (item.note ?? '').toLowerCase().includes(keyword) ||
        linkedName.toLowerCase().includes(keyword)
      );
    });
  }, [authorizations, filter, accountNameByID]);

  const handleRemove = useCallback(
    async (id: number) => {
      const ok = await store.deleteAuthorization([id]);
      if (!ok) {
        return;
      }
      setDetailTargetID(null);
      await onRefresh();
    },
    [store, onRefresh]
  );

  const handleFormSubmitted = useCallback(async () => {
    setFormOpen(false);
    await onRefresh();
  }, [onRefresh]);

  const openCreate = () => {
    setFormTarget(null);
    setFormOpen(true);
  };

  const openEdit = (authorization: AccountAuthorizationType) => {
    // 编辑入口来自详情弹窗：先收起详情再开表单，避免两个弹窗叠层
    setDetailTargetID(null);
    setFormTarget(authorization);
    setFormOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">授权关系</CardTitle>
          <CardDescription>共 {authorizations.length} 条</CardDescription>
          <Button size="sm" variant="outline" className="ml-auto" onClick={openCreate}>
            <Plus className="size-4" />
            添加授权
          </Button>
        </div>
        {authorizations.length > 0 && (
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="按站点 / 站点账号 / 备注 / 关联账号筛选"
            className="mt-2 h-9"
            autoComplete="off"
          />
        )}
      </CardHeader>
      <CardContent>
        {authorizations.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            还没有授权记录，添加一条吧
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            没有匹配的授权记录
          </p>
        ) : (
          // 授权可能几十条：卡片区内部滚动，避免把详情页的备注与右栏挤出首屏（PRD §10.4）
          <div className="max-h-[21rem] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {filtered.map((item) => (
                <AuthorizationCard
                  key={item.id}
                  authorization={item}
                  linkedAccountName={linkedNameOf(item.linked_account_id)}
                  onOpen={() => setDetailTargetID(item.id)}
                  onNavigateLinked={() => navigate(`/accounts/${item.linked_account_id}`)}
                  onRemove={() => handleRemove(item.id)}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {detailTarget && (
        <AuthorizationDetailDialog
          authorization={detailTarget}
          linkedAccountName={linkedNameOf(detailTarget.linked_account_id)}
          onOpenChange={(next) => {
            if (!next) {
              setDetailTargetID(null);
            }
          }}
          onEdit={() => openEdit(detailTarget)}
          onRemove={() => handleRemove(detailTarget.id)}
          onNavigateLinked={() => navigate(`/accounts/${detailTarget.linked_account_id}`)}
        />
      )}

      <AuthorizationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        accountId={accountId}
        authorization={formTarget}
        onSubmitted={handleFormSubmitted}
      />
    </Card>
  );
});
