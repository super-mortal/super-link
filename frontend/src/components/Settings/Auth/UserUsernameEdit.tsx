'use client';

import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import * as React from 'react';
import { StoreContext } from '@/store/storeContext.ts';

const formSchema = z.object({
  username: z.string().min(2, { message: '用户名至少需要2个字符。' }).max(30, { message: '用户名最多30个字符。' }),
});

export const UserUsernameEdit = () => {
  const store = React.useContext(StoreContext);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: store.user.username ?? '',
    },
  });
  const submit = async (values: z.infer<typeof formSchema>) => {
    return await store.updateUsername(values);
  };
  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
          <CardHeader>
            <CardTitle className="text-lg">修改用户名</CardTitle>
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
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              更新用户名
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
};
