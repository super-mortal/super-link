import { ScrollArea } from '@/components/ui/scroll-area';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { ChevronRightIcon, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import React, { startTransition, useContext, useEffect, useMemo } from 'react';
import { StoreContext } from '@/store/storeContext.ts';
import { cn, safeDecodeURI } from '@/lib/utils.ts';
import { UrlSchema } from '@/lib/types.ts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button.tsx';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { useUrlState } from '@/hooks/useUrlState.ts';

const normalizeUrl = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '') + new URL(u).pathname.replace(/\/$/, '');
  } catch {
    return u;
  }
};

const extractDomain = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

export const DuplicatesList = observer(({ url }: { url: string }) => {
  const store = useContext(StoreContext);
  const navigate = useNavigate();
  const { searchParams, setUrlState } = useUrlState();
  const isExpandedParam = useMemo(() => Boolean(searchParams.get('expand-duplicates')), [searchParams]);

  useEffect(() => {
    if (store.items.length === 0) {
      store.fetchItems();
    }
  }, [store]);

  let validUrl = null;
  try {
    validUrl = UrlSchema.parse(url);
  } catch {
    /* empty */
  }

  const items = useMemo(() => {
    return store.items.map((item) => ({
      ...item,
      normalizedUrl: normalizeUrl(item.url),
      domain: extractDomain(item.url),
    }));
  }, [store.items]);

  const exactMatches = useMemo(() => {
    if (!validUrl) {
      return [];
    }
    const normalizedUrl = normalizeUrl(validUrl);
    if (normalizedUrl === '') {
      return [];
    }
    return items.filter((item) => item.normalizedUrl === normalizedUrl);
  }, [items, validUrl]);

  const domainMatches = useMemo(() => {
    if (!validUrl) {
      return [];
    }
    const urlDomain = extractDomain(validUrl);
    if (urlDomain === '') {
      return [];
    }
    return items.filter((item) => item.domain === urlDomain && !exactMatches.includes(item));
  }, [items, validUrl, exactMatches]);

  const openItem = (itemID: number) => {
    navigate(`/edit-item/${itemID}?show-back=1`);
  };

  const onOpenChange = (isOpen: boolean) => {
    startTransition(() => {
      setUrlState(
        {
          'expand-duplicates': isOpen ? '1' : null,
        },
        { replace: true }
      );
    });
  };

  const exactMatchesCount = exactMatches.length;
  const domainMatchesCount = domainMatches.length;
  const totalMatchesCount = exactMatchesCount + domainMatchesCount;
  if (totalMatchesCount === 0) {
    return null;
  }

  const ItemCard = (item, highlightedText) => {
    const decodedHightlightedText = safeDecodeURI(highlightedText);
    const [before, after] = item.url.split(decodedHightlightedText);

    return (
      <Item variant="outline" size="sm" className="bookmark_item flex-nowrap" asChild key={item.id}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openItem(item.id);
          }}
        >
          <ItemContent>
            <ItemTitle className="line-clamp-1 wrap-anywhere">{item.title}</ItemTitle>
            <ItemDescription className="line-clamp-1 wrap-anywhere">
              {before}
              <span className="bg-red-50 text-red-400">{decodedHightlightedText}</span>
              {after}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon className="size-4" />
          </ItemActions>
        </a>
      </Item>
    );
  };

  return (
    <Card className="p-0">
      <CardContent className="p-0">
        <Collapsible className="m-0" defaultOpen={isExpandedParam} onOpenChange={onOpenChange}>
          <CollapsibleTrigger asChild>
            <Button variant="link" className="group w-full px-4! py-6">
              可能重复 - {exactMatchesCount > 0 && `${exactMatchesCount} 个精确匹配`}
              {domainMatchesCount > 0 && exactMatchesCount > 0 && '，'}
              {domainMatchesCount > 0 && `${domainMatchesCount} 个同域名匹配`}
              <ChevronsDownUp className="ml-auto hidden group-data-[state=open]:block" />
              <ChevronsUpDown className="ml-auto group-data-[state=open]:hidden" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="p-0">
            <ScrollArea className={cn('w-full', totalMatchesCount > 3 ? 'h-73' : '')}>
              <div className="flex w-full flex-col gap-2 px-3 pb-3">
                {exactMatches.map((item) => ItemCard(item, item.normalizedUrl))}
                {domainMatches.map((item) => ItemCard(item, item.domain))}
              </div>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
});
