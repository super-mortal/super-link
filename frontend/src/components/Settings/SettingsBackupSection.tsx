import * as React from 'react';
import { Bookmark, KeyRound, Server, Sparkles, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StoreContext, VaultStoreContext } from '@/store/storeContext';
import type { BackupModuleType } from '@/lib/types';
import { BackupCard } from './BackupCard';
import { VaultTransferCard } from './Vault/VaultTransferCard';

export type SettingsBackupSectionProps = {
  /** 点击卡片上的「恢复」时抛出模块名；恢复弹窗在 task21 实现，接线由 task22 负责 */
  onRestore?: (module: BackupModuleType) => void;
};

/**
 * 设置 → 备份分区（refinements §4.1 / §6.3）：四张板块卡片各自导出 / 恢复。
 *
 * 条数取 store 现有数据（与侧栏模块计数同源）：
 * - 书签 / Skill 列表由前端一次拉全量后分页，length 即总数；
 * - 服务器 / 账号库用后端返回的 total（随各自列表查询更新）。
 *
 * 导出直接调 mainStore.exportBackup（成功文案归 UI 层，store 不弹 toast）；
 * 恢复只抛 onRestore(module) 回调，本组件不调 previewRestore / restoreBackup。
 * 账号库卡片复用 VaultTransferCard（.slvault 加密导出导入），不重写加密逻辑。
 */
export const SettingsBackupSection = observer(({ onRestore }: SettingsBackupSectionProps) => {
  const store = React.useContext(StoreContext);
  const vault = React.useContext(VaultStoreContext);
  const [exportingModule, setExportingModule] = React.useState<BackupModuleType | null>(null);
  /** 条数补齐只做一次：失败也不在本次挂载内重试（避免请求失败后 loading 翻转引发循环） */
  const countsRequestedRef = React.useRef(false);

  /**
   * 进入「备份」分区时补齐服务器 / 账号库条数。
   *
   * 侧栏只在进入 /servers、/accounts 时才拉对应列表，直接从设置页打开备份分区时
   * store 里可能还没有总数；这里按既有方式补一次拉取（仍走 store，组件内不 fetch）。
   * 账号库先确认 vault.initialized：未初始化时 /api/accounts 返回 409，不能硬拉；
   * 元信息也拉取失败（metaLoadFailed）时放弃，避免反复请求。
   */
  React.useEffect(() => {
    if (countsRequestedRef.current) {
      return;
    }

    if (vault.initialized === null) {
      if (!vault.isPending && !vault.metaLoadFailed) {
        void vault.loadMeta();
      }
      return;
    }

    countsRequestedRef.current = true;

    if (store.serverTotal === 0) {
      void store.fetchServers(store.serverListParams);
    }
    if (vault.initialized === true && store.accountTotal === 0) {
      void store.fetchAccounts();
    }
  }, [vault, vault.initialized, vault.isPending, store]);

  const handleExport = async (module: BackupModuleType) => {
    setExportingModule(module);
    try {
      const ok = await store.exportBackup(module);
      if (ok) {
        toast.success(module === 'servers' ? '服务器备份已导出，含 Token 凭据，请妥善保管' : '备份已导出，请妥善保管', {
          position: 'top-center',
        });
      }
    } finally {
      setExportingModule(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">四个板块可分别导出与恢复；恢复前会先预检分类，确认后才写库。</p>

      <BackupCard
        icon={<Bookmark />}
        title="书签"
        description="只包含书签模块的标签与条目，按网址判重；Skill 标签不在备份范围内。"
        count={store.items.length}
        countUnit="条书签"
        onExport={() => void handleExport('bookmarks')}
        isExporting={exportingModule === 'bookmarks'}
        onRestore={() => onRestore?.('bookmarks')}
      />

      <BackupCard
        icon={<Sparkles />}
        title="Skill"
        description="只备份 GitHub 来源的安装地址与描述，恢复时按地址重新拉取最新版本；本地上传的 Skill 不受影响。"
        count={store.skills.length}
        countUnit="个 Skill"
        onExport={() => void handleExport('skills')}
        isExporting={exportingModule === 'skills'}
        onRestore={() => onRestore?.('skills')}
      />

      <BackupCard
        icon={<Server />}
        title="服务器"
        description="备份服务器配置与 Token 凭据，不含历史指标；Hub 地址不变时恢复后 agent 可直接继续连接。"
        count={store.serverTotal}
        countUnit="台服务器"
        onExport={() => void handleExport('servers')}
        isExporting={exportingModule === 'servers'}
        onRestore={() => onRestore?.('servers')}
        notice={
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>含 Token 凭据，请妥善保管</AlertTitle>
            <AlertDescription>
              备份文件包含各服务器的 Token 哈希与盐，等同凭据材料；请勿上传到公开网盘或聊天工具。
            </AlertDescription>
          </Alert>
        }
      />

      <BackupCard
        icon={<KeyRound />}
        title="账号库"
        description="沿用 .slvault 端到端加密备份，文件只含密文；导入前在浏览器校验主密码，密码错误不会上传。"
        count={store.accountTotal}
        countUnit="个账号"
      >
        <VaultTransferCard />
      </BackupCard>
    </div>
  );
});
