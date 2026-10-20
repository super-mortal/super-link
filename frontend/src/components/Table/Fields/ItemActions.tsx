import React from 'react';
import { StoreContext } from '@/store/storeContext.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EllipsisVertical, Maximize } from 'lucide-react';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';

export const ItemsActions = ({ row }) => {
  const itemID = row.original.id;
  const store = React.useContext(StoreContext);
  const handleEdit = () => {
    store.openItemEditModal(itemID);
  };

  const handleMakeCopy = async () => {
    const result = await store.createItem(row.original);
    if (!result) {
      return;
    }
    store.fetchItems();
  };

  const handleRefetch = async () => {
    const result = await store.refetchItemsMetadata([itemID]);
    if (!result) {
      return;
    }
    store.fetchItems();
  };

  const handleDelete = async () => {
    const result = await store.deleteItems([itemID]);
    if (!result) {
      return;
    }
    store.fetchItems();
  };

  return (
    <div className="flex gap-1">
      <Button onClick={handleEdit} variant="outline" className="onhover-visible">
        <Maximize />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="onhover-visible !pr-1.5 !pl-1.5">
            <EllipsisVertical />
            <span className="sr-only">打开菜单</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={handleRefetch}>刷新元数据</DropdownMenuItem>
          <DropdownMenuItem onClick={handleMakeCopy}>创建副本</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DeleteDialog onConfirm={handleDelete} itemsCount={1}>
            <div className="focus:bg-accent focus:text-accent-foreground hover:bg-destructive/90 relative flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm transition-colors outline-none select-none hover:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
              删除
            </div>
          </DeleteDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
