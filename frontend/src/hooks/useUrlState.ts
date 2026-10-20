import { NavigateOptions, useSearchParams } from 'react-router-dom';

export const useUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const setUrlState = (updates: Record<string, string | number | null>, options?: NavigateOptions) => {
    setSearchParams(
      (prev) => {
        Object.entries(updates).forEach(([key, value]) => {
          if (value === null || value === '') {
            prev.delete(key);
          } else {
            prev.set(key, `${value}`);
          }
        });

        return prev;
      },
      options ?? { replace: false }
    );
  };

  return { searchParams, setUrlState };
};
