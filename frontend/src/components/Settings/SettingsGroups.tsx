import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { StoreContext, VaultStoreContext } from '@/store/storeContext';
import { GroupManageCard } from './GroupManageCard';

/**
 * 设置 → 分组（refinements-v0.1.2 §3.3）：「账号库分组」「服务器分组」两张卡片。
 *
 * 字典来自两个独立接口（GET /api/account-groups、GET /api/servers/groups）：
 * 进入分区时各静默拉取一次；新增 / 重命名 / 删除后由 store 方法自行刷新字典与列表计数。
 * 账号库未初始化时 /api/account-groups 返回 409，卡片改为只读说明，不硬拉。
 */
export const SettingsGroups = observer(() => {
  const store = React.useContext(StoreContext);
  const vault = React.useContext(VaultStoreContext);
  /** 字典各拉一次：失败也不在本组件挂载期内反复重试 */
  const serverDictRequestedRef = React.useRef(false);
  const accountDictRequestedRef = React.useRef(false);

  React.useEffect(() => {
    if (!serverDictRequestedRef.current) {
      serverDictRequestedRef.current = true;
      void store.fetchServerGroups();
    }

    if (vault.initialized === null) {
      if (!vault.isPending && !vault.metaLoadFailed) {
        void vault.loadMeta();
      }
      return;
    }

    if (vault.initialized === true && !accountDictRequestedRef.current) {
      accountDictRequestedRef.current = true;
      void store.fetchAccountGroups();
    }
  }, [store, vault, vault.initialized, vault.isPending, vault.metaLoadFailed]);

  let accountDisabledReason: string | null = null;
  if (vault.initialized === false) {
    accountDisabledReason = '账号库尚未初始化，设置主密码后即可管理分组。';
  } else if (vault.initialized === null) {
    accountDisabledReason = '正在读取账号库状态…';
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        分组统一在这里维护，模块内的表单与侧栏只做选择；非空分组需先把数据移出再删除。
      </p>

      <GroupManageCard
        title="账号库分组"
        description="账号库的账号分组；重命名只改字典行，组内账号按关联自动跟随。"
        groups={store.accountGroups}
        countUnit="个账号"
        disabledReason={accountDisabledReason}
        onCreate={store.createAccountGroup}
        onRename={store.renameAccountGroup}
        onDelete={store.deleteAccountGroup}
      />

      <GroupManageCard
        title="服务器分组"
        description="服务器的分组字典；重命名会同步更新组内服务器，侧栏筛选按分组名变化。"
        groups={store.serverGroupDict}
        countUnit="台服务器"
        onCreate={store.createServerGroup}
        onRename={store.renameServerGroup}
        onDelete={store.deleteServerGroup}
      />
    </div>
  );
});
