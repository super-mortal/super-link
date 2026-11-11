import { useContext, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';

/**
 * 重置账号库（PRD §7.7：忘记主密码只能重置，原密文永久不可解）。
 *
 * 二次确认按 PRD 要求输入登录密码：它只在前端做「确认你是账号所有者」的一道门，
 * 不发给服务端（后端 reset 只依赖登录态，密码校验逻辑全项目只有登录一处实现）。
 * 弹窗里明确写出后果——删除所有账号与密文且不可恢复——避免误触。
 */
export const VaultResetCard = observer(() => {
  const vault = useContext(VaultStoreContext);
  const [open, setOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    const ok = await vault.resetVault(loginPassword);
    if (!ok) {
      setError(vault.error);
      return;
    }
    setOpen(false);
    setLoginPassword('');
    setError(null);
    toast.success('账号库已重置，重新设置主密码后即可再次使用', { position: 'top-center' });
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive text-lg">重置账号库</CardTitle>
        <CardDescription>忘记主密码时的唯一选择。将删除所有账号与密文，且不可恢复。</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          重置后账号库回到未初始化状态，需要重新设置主密码；此前的密码、两步验证与备注将永久无法找回。
          如有加密备份（.slvault），重置后仍可用它恢复。
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="destructive" className="w-full" onClick={() => setOpen(true)} disabled={vault.isPending}>
          重置账号库
        </Button>
      </CardFooter>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setLoginPassword('');
            setError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认重置账号库</AlertDialogTitle>
            <AlertDialogDescription>
              将删除所有账号与密文，且不可恢复。此操作无法撤销，请谨慎确认。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vault-reset-login-password">登录密码</Label>
            <Input
              id="vault-reset-login-password"
              type="password"
              autoComplete="current-password"
              placeholder="输入当前账号的登录密码以确认"
              value={loginPassword}
              onChange={(event) => {
                setLoginPassword(event.target.value);
                setError(null);
              }}
            />
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={!loginPassword || vault.isPending}
              onClick={(event) => {
                // 拦截 AlertDialogAction 的默认关闭行为：重置失败时要留在弹窗里显示错误
                event.preventDefault();
                void handleReset();
              }}
            >
              {vault.isPending && <Spinner />}
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
});
