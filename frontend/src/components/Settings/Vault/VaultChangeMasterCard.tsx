import { useContext, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import z from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { MIN_MASTER_PASSWORD_LENGTH } from '@/lib/vaultConstants.ts';

const formSchema = z
  .object({
    currentPassword: z.string().min(1, { message: '请输入当前主密码' }),
    newPassword: z.string().min(MIN_MASTER_PASSWORD_LENGTH, {
      message: `新主密码至少 ${MIN_MASTER_PASSWORD_LENGTH} 个字符`,
    }),
    confirmPassword: z.string().min(1, { message: '请再次输入新主密码' }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: '两次输入的新主密码不一致',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof formSchema>;

/**
 * 修改主密码（PRD §7.1 / §7.7）。
 *
 * 链路在 vaultStore.changeMasterPassword 里：旧密码派生 KEK 解出 DEK -> 新密码派生
 * 新 KEK 重裹同一把 DEK -> 写 /api/vault/change-master。数据密钥不变，所有账号密文
 * 无需重新加密；旧密码正确性由本地 GCM 校验判断（服务端不提供验证主密码接口）。
 *
 * 为什么要求先解锁：store 的换密流程以「会话里有 DEK」为前提（解锁态才允许进入本卡片），
 * 锁定态只给提示，不渲染表单——避免用户在锁定态反复提交换来一句「请先解锁」。
 */
export const VaultChangeMasterCard = observer(() => {
  const vault = useContext(VaultStoreContext);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: FormValues) => {
    const ok = await vault.changeMasterPassword(values.currentPassword, values.newPassword);
    if (!ok) {
      // 错误就地显示在表单内（dev-spec：本地错误不弹统一「操作失败」）
      setError(vault.error);
      return;
    }
    setError(null);
    form.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
    toast.success('主密码已更新，请使用新主密码解锁账号库', { position: 'top-center' });
  };

  if (!vault.unlocked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">修改主密码</CardTitle>
          <CardDescription>更换解锁账号库的主密码，已保存的账号数据无需重新录入。</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">账号库未解锁。请先到「账号库」页面解锁，再修改主密码。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <CardHeader>
            <CardTitle className="text-lg">修改主密码</CardTitle>
            <CardDescription>更换解锁账号库的主密码，已保存的账号数据无需重新录入。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>当前主密码</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" placeholder="输入当前主密码" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>新主密码</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" placeholder="输入新主密码" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>确认新主密码</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" placeholder="再次输入新主密码" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || vault.isPending}>
              {vault.isPending && <Spinner />}
              更新主密码
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
});
