'use client';

import { Button } from '@/components/ui/button.tsx';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { useContext } from 'react';
import { StoreContext } from '@/store/storeContext.ts';

export function UserDelete() {
  const store = useContext(StoreContext);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">禁用认证</CardTitle>
        <CardDescription>禁用认证将删除您的用户账户并禁用登录功能。</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button onClick={store.deleteUser} variant="destructive" className="w-full">
          禁用认证
        </Button>
      </CardFooter>
    </Card>
  );
}
