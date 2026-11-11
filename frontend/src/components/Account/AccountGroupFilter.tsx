import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Check, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import { useAccountListState } from '@/hooks/useAccountListState.ts';

/**
 * 分组筛选下拉（PRD §9.6 的 `group` 参数入口）。
 *
 * 分组字典来自 `mainStore.accountGroups`：后端暂无独立分组接口，分组名只能从
 * 账号列表响应派生（mainStore 已有注释），因此「一个账号都没有的分组」不可见。
 * 没有可用分组时不渲染入口，只保留 URL 参数支持。
 */
export const AccountGroupFilter = observer(() => {
  const store = React.useContext(StoreContext);
  const { group, setGroupFilter } = useAccountListState();

  if (store.accountGroups.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <FolderTree />
          <span className="hidden @xl/main:inline-block">分组</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>分组</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setGroupFilter(null)}>
          <span className="flex-1">全部分组</span>
          {group === null && <Check className="text-primary" />}
        </DropdownMenuItem>
        {store.accountGroups.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => setGroupFilter(item.id)}>
            <span className="flex-1 truncate">{item.name}</span>
            {group === item.id && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
