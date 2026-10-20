import EditItemForm from '@/components/EditItem/EditItemForm.tsx';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { safeDecodeURIComponent } from '@/lib/utils.ts';

export const CreateItem = observer(() => {
  const [searchParams] = useSearchParams();

  const urlParams = useMemo(() => {
    return {
      url: safeDecodeURIComponent(searchParams.get('url') || ''),
      title: safeDecodeURIComponent(searchParams.get('title') || ''),
      description: safeDecodeURIComponent(searchParams.get('description') || ''),
    };
  }, [searchParams]);

  return <EditItemForm isCloseWindowOnSubmit={true} item={null} predefinedValues={urlParams} />;
});
