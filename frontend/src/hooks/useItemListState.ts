import { useContext } from 'react';
import { StoreContext } from '@/store/storeContext.ts';
import { useUrlState } from '@/hooks/useUrlState.ts';
import { TagFilterType } from '@/lib/types.ts';

export const useItemListState = () => {
  const { setUrlState } = useUrlState();
  const store = useContext(StoreContext);

  const setTagFilter = (tagFilter: TagFilterType, skipURLUpdate = false) => {
    store.setTagFilter(tagFilter);

    if (skipURLUpdate) {
      return;
    }

    setUrlState({
      tag: tagFilter,
      // Preventing race conditions
      page: 1,
    });
  };

  return {
    setTagFilter,
  };
};
