'use client';

import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
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
    password: z.string().min(6, {
      message: '密码至少需要6个字符。',
    }),
    confirm_password: z.string().min(6, {
      message: '密码至少需要6个字符。',
    }),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: '密码不匹配',
    path: ['confirm_password'],
  });

export function UserPasswordEdit() {
  const store = useContext(StoreContext);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: '',
      confirm_password: '',
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const success = await store.updatePassword(values);
    if (success) {
      form.reset();
    }
    return success;
  };

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <CardHeader>
            <CardTitle className="text-lg">修改密码</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>密码</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="密码" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirm_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>确认密码</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="确认密码" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              修改密码
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
