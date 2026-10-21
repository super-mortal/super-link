import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Copy, Download, Ellipsis, Eye, Maximize2, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { StoreContext } from '@/store/storeContext.ts';
import { MODULES } from '@/lib/modules.ts';
import type { ModuleItemType } from '@/lib/modules.ts';
import type { ModuleKey } from '@/lib/types.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { cn } from '@/lib/utils.ts';
import { isSkillItem } from '@/components/Table/Fields/moduleItem.ts';

const actionButtonClass =
  'onhover-visible text-muted-foreground bg-background hover:bg-accent hover:text-foreground flex h-8 shrink-0 items-center justify-center rounded-md border px-2 shadow-xs transition-colors';

/** 卡片 / 列表 / 表格共用的「打开」逻辑：有详情页走路由，否则开编辑弹窗 */
export const useModuleItemOpen = (module: ModuleKey) => {
  const store = React.useContext(StoreContext);
  const navigate = useNavigate();
  const detailPath = MODULES[module].routes.detail;

  return React.useCallback(
    (item: ModuleItemType) => {
      if (detailPath) {
        navigate(detailPath(item.id));
        return;
      }
      store.openItemEditModal(item.id);
    },
    [detailPath, navigate, store]
  );
};

/** 右上角「展开 + ⋯」双按钮，菜单项按模块区分；定位由父容器负责 */
export const ModuleCardActions = observer(({ module, item }: { module: ModuleKey; item: ModuleItemType }) => {
  const store = React.useContext(StoreContext);
  const openItem = useModuleItemOpen(module);
  const [pendingAction, setPendingAction] = React.useState<'check' | 'export' | null>(null);

  const detailPath = MODULES[module].routes.detail;
  const isSkill = isSkillItem(item);
  // 上传来源没有上游仓库，菜单项直接禁用，不靠后端 SL-SKL-0005 兜底
  const isUpdatable = isSkill && item.source_type === 'github';
  const noUpstreamHint = '上传来源无上游更新';

  const checkUpdates = async () => {
    setPendingAction('check');

    try {
      // 只检查当前这一行，其它行的 hasUpdate 保持不变
      const updates = await store.checkSkillUpdates([item.id]);

      if (updates === null) {
        return;
      }

      toast(updates.some((update) => update.id === item.id) ? '该 Skill 有新版本可用' : '该 Skill 已是最新版本', {
        position: 'top-center',
      });
    } finally {
      setPendingAction(null);
    }
  };

  const exportSkill = async () => {
    setPendingAction('export');
    try {
      // 成功/失败的提示都在 store 里统一 toast，这里只管加载态
      await store.exportSkill(item.id);
    } finally {
      setPendingAction(null);
    }
  };

  const makeCopy = async () => {
    if (isSkill) {
      return;
    }
    const created = await store.createItem({ ...item });
    if (!created) {
      return;
    }
    store.fetchItems();
  };

  const handleDelete = async () => {
    if (isSkill) {
      await store.deleteSkills([item.id]);
      return;
    }
    const result = await store.deleteItems([item.id]);
    if (!result) {
      return;
    }
    store.fetchItems();
  };

  return (
    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={detailPath ? '查看详情' : '编辑'}
        title={detailPath ? '查看详情' : '编辑'}
        className={actionButtonClass}
        onClick={() => openItem(item)}
      >
        <Maximize2 className="size-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="更多操作" title="更多操作" className={cn(actionButtonClass, 'px-1.5')}>
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {isSkill ? (
            <>
              <DropdownMenuItem onSelect={() => openItem(item)}>
                <Eye />
                查看详情
              </DropdownMenuItem>
              <DropdownMenuItem
                // 不关闭菜单，才能在条目上显示「检查中/导出中」的转圈状态
                onSelect={(event) => {
                  event.preventDefault();
                  checkUpdates();
                }}
                disabled={pendingAction !== null || !isUpdatable}
                title={isUpdatable ? undefined : noUpstreamHint}
              >
                {pendingAction === 'check' ? <Spinner /> : <RefreshCw />}
                检查更新
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  exportSkill();
                }}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'export' ? <Spinner /> : <Download />}
                导出
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => store.openItemEditModal(item.id)}>
                <Pencil />
                编辑
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={makeCopy}>
                <Copy />
                创建副本
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {/* 菜单项包在 DeleteDialog 里保持菜单不关闭，才能弹出二次确认 */}
          <DeleteDialog onConfirm={handleDelete} itemsCount={1} noun={isSkill ? 'Skill' : '项目'}>
            <div className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors outline-none select-none">
              <Trash2 className="size-4" />
              删除
            </div>
          </DeleteDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
