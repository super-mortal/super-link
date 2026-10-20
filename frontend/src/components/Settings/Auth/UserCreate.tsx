'use client';

import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useContext } from 'react';
import { StoreContext } from '@/store/storeContext.ts';
import z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';

const formSchema = z
  .object({
    username: z.string().min(2, { message: '用户名至少需要2个字符。' }).max(30, { message: '用户名最多30个字符。' }),
    password: z.string().min(6, { message: '密码至少需要6个字符。' }),
    confirm_password: z.string().min(6, { message: '密码确认至少需要6个字符。' }),
  })
  .refine(
    (data: { password: string; confirm_password: string }) => {
      return data.password === data.confirm_password;
    },
    {
      message: '密码不匹配。',
      path: ['confirm_password'],
    }
  );

export const UserCreate = ({ onSuccess }: { onSuccess?: () => void }) => {
  const store = useContext(StoreContext);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
      password: '',
      confirm_password: '',
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const success = await store.createUser(values);
    if (success && onSuccess) {
      onSuccess();
    }
  };
  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <CardHeader>
            <CardTitle className="text-lg">创建用户账户</CardTitle>
            <CardDescription>
              创建用户账户以启用 Super-Link
              实例的身份验证。如果没有用户账户，身份验证将被禁用，任何可以访问该实例的人都可以使用它。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>用户名</FormLabel>
                    <FormControl>
                      <Input placeholder="用户名" autoComplete="username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>密码</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" placeholder="密码" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="confirm_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>确认密码</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" placeholder="确认密码" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              创建用户
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
};
