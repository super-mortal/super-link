import { useContext } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { observer } from 'mobx-react-lite';
import z from 'zod';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';

const unlockSchema = z.object({
  password: z.string().min(1, { message: '请输入主密码' }),
});

type UnlockFormValues = z.infer<typeof unlockSchema>;

/** 自动锁定说明文案；账号库设置页（后续任务）也会复用同一口径 */
export const formatAutoLockText = (minutes: number): string =>
  minutes > 0 ? `闲置 ${minutes} 分钟自动锁定，刷新页面也会立即锁定` : '已关闭自动锁定，刷新页面仍会立即锁定';

/** 主密码输入框的 id：锁定态工具栏的「解锁账号库」按钮靠它把焦点送进来 */
export const VAULT_PASSWORD_INPUT_ID = 'vault-master-password';

/**
 * 解锁表单（PRD §7.2 / §10.1）。
 *
 * 错误提示区只显示 store 给出的统一文案（「主密码错误」），不区分是密码错还是密文损坏；
 * 连续失败时 store 会在返回前延迟 0.5s → 1s → 2s…，期间按钮保持禁用。
 */
export const VaultUnlockForm = observer(() => {
  const vault = useContext(VaultStoreContext);

  const form = useForm<UnlockFormValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = async (values: UnlockFormValues) => {
    await vault.unlock(values.password);
    // 无论成功失败都清空输入框：失败后不该继续把错误主密码留在界面里
    form.reset({ password: '' });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>主密码</FormLabel>
              <FormControl>
                <Input
                  id={VAULT_PASSWORD_INPUT_ID}
                  type="password"
                  autoComplete="current-password"
                  placeholder="输入主密码"
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {vault.unlockError && (
          <p className="text-destructive text-sm" role="alert">
            {vault.unlockError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={vault.isPending}>
          {vault.isPending && <Spinner />}
          解锁
        </Button>

        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{formatAutoLockText(vault.autoLockMinutes)}</span>
        </p>
      </form>
    </Form>
  );
});
