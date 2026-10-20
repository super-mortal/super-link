import EditItemForm from '@/components/EditItem/EditItemForm.tsx';
import { observer } from 'mobx-react-lite';
import { useParams } from 'react-router';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { StoreContext } from '@/store/storeContext.ts';
import { Spinner } from '@/components/ui/spinner.tsx';
import { NotFound } from '@/layouts/NotFound.tsx';
import { useSearchParams } from 'react-router-dom';

export const EditItem = observer(() => {
  const store = useContext(StoreContext);
  const params = useParams();
  const itemID = Number(params.itemID);
  const [isLoading, setIsLoading] = useState(true);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (store.items.length > 0) {
      setIsLoading(false);
      return;
    }
    const loadData = async () => {
      await store.fetchItems();
      setIsLoading(false);
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = useMemo(() => {
    return store.items.find((item) => item.id === itemID);
  }, [store.items, itemID]);

  const showBackButton = useMemo(() => Boolean(searchParams.get('show-back')), [searchParams]);

  if (isLoading) {
    return (
      <div className="bg-background flex h-full min-h-screen w-full flex-col items-center justify-center">
        <Spinner className="h-10 w-10" />
      </div>
    );
  }

  if (!item) {
    return (
      <NotFound>
        <h1>书签不存在</h1>
        <p>您查找的书签不存在。</p>
      </NotFound>
    );
  }

  return <EditItemForm isCloseWindowOnSubmit={true} item={item} showBackButton={showBackButton} />;
});
