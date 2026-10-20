import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import z from 'zod';
import { useContext, useEffect } from 'react';
import { StoreContext } from '@/store/storeContext';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form';
import { useLocation, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Auth } from '@/layouts/Auth.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';

const formSchema = z.object({
  username: z.string().min(1, { message: '用户名是必填项' }),
  password: z.string().min(1, { message: '密码是必填项' }),
});
export const Login = observer(() => {
  const location = useLocation();
  const store = useContext(StoreContext);
  const navigate = useNavigate();

  // Redirect if user already logged in
  useEffect(() => {
    if (store.isAuthRequired) {
      return;
    }

    const redirectUrl = location.state?.from?.pathname
      ? location.state.from.pathname + location.state?.from?.search
      : '/';
    navigate(redirectUrl, { replace: true });
  }, [store.isAuthRequired, location.state?.from?.pathname, location.state?.from?.search, navigate]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    await store.login(values);
  }

  return (
    <Auth>
      <div className="w-full max-w-sm min-w-xs">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">登录您的账户</CardTitle>
                <CardDescription>在下方输入您的用户名和密码</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-6 pb-3 text-left">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem className="gap-3">
                        <FormLabel>用户名</FormLabel>
                        <FormControl>
                          <Input placeholder="输入您的用户名" autoComplete="username" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="gap-3">
                        <div className="flex items-center">
                          <FormLabel>密码</FormLabel>
                        </div>
                        <FormControl>
                          <Input type="password" autoComplete="password" placeholder="输入您的密码" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Spinner />}
                    登录
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>
      </div>
    </Auth>
  );
});
