import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { VaultLockCard } from './Vault/VaultLockCard.tsx';
import { VaultChangeMasterCard } from './Vault/VaultChangeMasterCard.tsx';
import { VaultTransferCard } from './Vault/VaultTransferCard.tsx';
import { VaultResetCard } from './Vault/VaultResetCard.tsx';

/**
 * 设置页「账号库」分区（PRD §9.3）。
 *
 * 四张卡片 + 一段安全模型说明：
 * - 锁定与显示：自动锁定时长、TOTP 显示策略、复制密码二次确认（都是本机偏好，写 localStorage）；
 * - 修改主密码：换密码不换数据密钥——用旧密码解出 DEK、再用新密码重裹（vaultStore 已实现完整链路）；
 * - 加密导出 / 导入：.slvault 备份的下载与恢复，导入后必须重新解锁；
 * - 重置账号库：忘记主密码的唯一出路，删除所有账号与密文且不可恢复。
 *
 * 解锁态、初始化状态都来自 vaultStore（UI 态）；本分区不直接调用接口，
 * 导出 / 导入走 mainStore（AGENTS.md：API 调用集中在 mainStore）。
 */
export const SettingsVault = observer(() => {
  const vault = React.useContext(VaultStoreContext);

  // 用户可能从未访问过 /accounts，此时 initialized 还是 null（meta 未拉过）。
  // 主动补一次拉取，决定导出 / 重置等入口是可用还是提示「请先初始化」。
  React.useEffect(() => {
    if (vault.initialized === null && !vault.isPending) {
      void vault.loadMeta();
    }
  }, [vault]);

  return (
    <div className="flex flex-col gap-4">
      <VaultLockCard />
      <VaultChangeMasterCard />
      <VaultTransferCard />
      {vault.initialized === true && <VaultResetCard />}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">安全模型</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="ml-4 list-disc space-y-2 text-sm">
            <li>
              所有账号的密码、两步验证密钥与备注都在你的浏览器里用主密码派生的密钥加密，服务器只保存密文，看不到任何内容。
            </li>
            <li>加密备份（.slvault）同样只含密文：拿到文件没有主密码也无法解密，请把主密码与备份文件分开保管。</li>
            <li>主密码不会上传，也无法找回——忘记主密码只能重置账号库，原加密数据将永久无法恢复。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
});
