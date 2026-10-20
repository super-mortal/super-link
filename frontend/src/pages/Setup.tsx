import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { observer } from 'mobx-react-lite';
import { useContext, useState } from 'react';
import { StoreContext } from '@/store/storeContext.ts';
import { Navigate, useNavigate } from 'react-router-dom';

export const Setup = observer(() => {
  const store = useContext(StoreContext);
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const submit = async () => {
    setIsLoading(true);
    const success = await store.initializeDatabase();
    if (success) {
      navigate('/setup/auth', { replace: true });
    }
    setIsLoading(false);
  };

  if (!isLoading && !store.isSetupRequired) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-start gap-8 px-3 py-16 text-left">
      <div className="flex items-center justify-center gap-2.5">
        <img src="logo.jpg" alt="Super-Link logo" className="h-auto w-[30px]" />
        <h2 className="text-2xl font-semibold tracking-tight">Super-Link</h2>
      </div>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-lg">欢迎使用 Super-Link！</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <p>在使用应用程序之前，我们需要设置数据库。点击下面的按钮继续。</p>

          <div className="rounded-lg bg-blue-100 p-4 dark:bg-blue-600">
            <p className="italic">
              <strong>注意：</strong> 这将在您的应用程序安装目录的 <code>/storage</code> 文件夹中创建一个数据库文件。
            </p>
          </div>
          <Button className="w-full" disabled={isLoading} onClick={submit}>
            {isLoading ? '正在创建数据库...' : '创建数据库'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});
