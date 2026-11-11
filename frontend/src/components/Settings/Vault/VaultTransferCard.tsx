import { useContext, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { StoreContext, VaultStoreContext } from '@/store/storeContext.ts';
import { parseVaultBackup, verifyVaultBackup } from '@/lib/vaultBackup.ts';
import type { VaultImportModeType } from '@/lib/types.ts';

/** 两种导入模式的说明文案：随选择即时切换，降低误用 replace 清空数据的风险 */
const MODE_HINTS: Record<VaultImportModeType, string> = {
  merge:
    '合并导入：本地已有的账号与授权保持不变，只导入缺失的内容；要求备份与当前账号库是同一把数据密钥（同一台设备或同一账号库的备份）。',
  replace:
    '覆盖导入：清空当前所有账号与授权，按备份完整恢复，账号库的加密参数也会换成备份的；导入后请使用备份文件的主密码解锁。',
};

/**
 * 加密导出 / 导入（PRD §7.5 / §8.1）。
 *
 * 导出：GET /api/vault/export 拿到的就是 .slvault 文件内容（只有密文），
 * 前端负责存盘（与书签导出同一套 Blob 下载写法，接口集中在 mainStore）。
 *
 * 导入前置校验（PRD §8.1「需主密码解密校验后合并/覆盖」）：先在浏览器里解析文件结构，
 * 再用备份的主密码派生 KEK 尝试解包 wrapped_dek——GCM 校验失败（密码错或文件损坏）
 * 就不发给后端，避免把一份解不开的备份导入进来搅乱当前账号库。
 *
 * 为什么导入成功后必须重新解锁：当前会话里的 DEK 属于导入前的账号库；
 * replace 导入会把 vault_meta 换成备份的 wrapped_dek，新旧包裹信息不匹配，
 * 继续用旧 DEK 解密会全部失败；merge 虽保留本地 meta，但为口径统一（也清掉可能
 * 引用旧 id 的解密缓存），一律锁定并重新拉取元信息，引导用户用（备份的）主密码解锁。
 */
export const VaultTransferCard = observer(() => {
  const store = useContext(StoreContext);
  const vault = useContext(VaultStoreContext);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mode, setMode] = useState<VaultImportModeType>('merge');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const resetImportForm = () => {
    setSelectedFile(null);
    setPassword('');
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const ok = await store.exportVault();
      if (ok) {
        toast.success('加密备份已导出，请妥善保管（解密需要主密码）', { position: 'top-center' });
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      return;
    }

    setError(null);
    setIsImporting(true);
    try {
      const backup = parseVaultBackup(await selectedFile.text());
      if (!backup) {
        setError('文件格式不正确，请选择从本应用导出的 .slvault 备份文件');
        return;
      }

      const verified = await verifyVaultBackup(backup, password);
      if (!verified.ok) {
        setError(verified.message);
        return;
      }

      const ok = await store.importVault(selectedFile, mode);
      if (!ok) {
        // 后端的拒绝原因（密钥不一致、结构非法等）已由统一请求层 toast 中文提示，这里不重复
        return;
      }

      vault.lock();
      await vault.loadMeta();
      toast.success('导入成功，请重新解锁账号库（覆盖导入请使用备份文件的主密码）', { position: 'top-center' });
      resetImportForm();
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">加密导出 / 导入</CardTitle>
        <CardDescription>
          导出只含密文的 .slvault 备份，或从备份恢复账号库。备份的安全完全由主密码保证，请与备份文件分开保管。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Button
            className="w-fit"
            variant="outline"
            onClick={handleExport}
            disabled={isExporting || vault.initialized !== true}
          >
            {isExporting && <Spinner />}
            <Download className="mr-2 h-4 w-4" />
            导出加密备份
          </Button>
          {vault.initialized !== true && (
            <p className="text-muted-foreground text-sm">账号库尚未初始化，设置主密码后即可导出备份。</p>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="vault-import-file">.slvault 备份文件</Label>
            <Input
              id="vault-import-file"
              ref={inputRef}
              accept=".slvault"
              type="file"
              disabled={isImporting}
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vault-import-mode">导入模式</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as VaultImportModeType)}>
              <SelectTrigger id="vault-import-mode" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">合并导入</SelectItem>
                <SelectItem value="replace">覆盖导入</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">{MODE_HINTS[mode]}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vault-import-password">备份的主密码</Label>
            <Input
              id="vault-import-password"
              type="password"
              autoComplete="off"
              placeholder="输入导出该备份时使用的主密码"
              value={password}
              disabled={isImporting}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
            />
            <p className="text-muted-foreground text-sm">主密码只在浏览器里用于校验备份能否解密，不会上传到服务器。</p>
          </div>

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={handleImport} disabled={!selectedFile || !password || isImporting}>
          {isImporting && <Spinner />}
          <Upload className="mr-2 h-4 w-4" />
          导入备份
        </Button>
      </CardFooter>
    </Card>
  );
});
