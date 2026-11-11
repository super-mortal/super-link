import { useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import { PreferencesStoreContext, VaultStoreContext } from '@/store/storeContext.ts';
import { formatAutoLockText } from '@/components/Account/VaultUnlockForm.tsx';
import { AUTOLOCK_OPTIONS } from '@/lib/vaultConstants.ts';

/**
 * 锁定与显示策略（PRD §7.2 / §7.3 / §7.4）。
 *
 * 三个设置都是纯本机偏好（preferencesStore -> localStorage `app:preferences`），
 * 不经过任何接口：自动锁定时长由 vaultStore 的巡检逻辑消费，另外两个分别由
 * 账号详情页（TOTP 自动显示）与复制入口（二次确认）消费。
 */
export const VaultLockCard = observer(() => {
  const vault = useContext(VaultStoreContext);
  const preferences = useContext(PreferencesStoreContext);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">锁定与显示</CardTitle>
        <CardDescription>自动锁定时长与敏感信息的显示策略。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="vault-autolock-minutes">自动锁定</Label>
          <Select
            value={String(vault.autoLockMinutes)}
            onValueChange={(value) => vault.setAutoLockMinutes(Number(value))}
          >
            <SelectTrigger id="vault-autolock-minutes" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* 0 表示不自动锁定（PRD §7.2 可选值：1/5/15/30/60 分钟或不锁定） */}
              {AUTOLOCK_OPTIONS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes > 0 ? `${minutes} 分钟` : '不锁定'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">{formatAutoLockText(vault.autoLockMinutes)}</p>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="vault-totp-auto-reveal"
            checked={preferences.vaultTotpAutoReveal}
            onCheckedChange={(checked) => preferences.setVaultTotpAutoReveal(checked === true)}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="vault-totp-auto-reveal">详情页自动显示动态码</Label>
            <p className="text-muted-foreground text-sm">
              关闭时，打开账号详情不会自动解密两步验证密钥，需要点击「显示动态码」才会按需解密。
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="vault-copy-password-confirm"
            checked={preferences.vaultCopyPasswordConfirm}
            onCheckedChange={(checked) => preferences.setVaultCopyPasswordConfirm(checked === true)}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="vault-copy-password-confirm">复制密码前二次确认</Label>
            <p className="text-muted-foreground text-sm">
              复制密码前弹确认框。剪贴板内容不会被自动清除，确认是误触复制的唯一缓冲。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
