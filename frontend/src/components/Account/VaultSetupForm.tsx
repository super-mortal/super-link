import { useContext } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { observer } from 'mobx-react-lite';
import z from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form.tsx';
import { VaultStoreContext } from '@/store/storeContext.ts';
import { MIN_MASTER_PASSWORD_LENGTH } from '@/lib/vaultConstants.ts';

/**
 * 首次设置主密码表单（PRD §7.1 / §10.1）。
 *
 * 主密码只在提交瞬间作为局部变量交给 vaultStore.setupVault()，不写入任何 store 字段、
 * 不进 URL、不进 toast；成功后由 store 直接把新 DEK 放进内存会话，页面随即进入解锁态。
 */
const setupSchema = z
  .object({
    password: z.string().min(MIN_MASTER_PASSWORD_LENGTH, {
      message: `主密码至少 ${MIN_MASTER_PASSWORD_LENGTH} 个字符`,
    }),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    message: '两次输入的主密码不一致',
    path: ['confirm'],
  });

type SetupFormValues = z.infer<typeof setupSchema>;

export const VaultSetupForm = observer(() => {
  const vault = useContext(VaultStoreContext);

  const form = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async (values: SetupFormValues) => {
    const ok = await vault.setupVault(values.password);
    if (ok) {
      // 成功后立刻清掉表单里的明文引用
      form.reset({ password: '', confirm: '' });
    }
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
                <Input type="password" autoComplete="new-password" placeholder="输入主密码" autoFocus {...field} />
              </FormControl>
              <FormDescription>
                至少 {MIN_MASTER_PASSWORD_LENGTH} 个字符，账号库的所有密码都由它派生保护。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>确认主密码</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" placeholder="再次输入主密码" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {vault.error && (
          <p className="text-destructive text-sm" role="alert">
            {vault.error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={vault.isPending}>
          {vault.isPending && <Spinner />}
          设置主密码并解锁
        </Button>
      </form>
    </Form>
  );
});
