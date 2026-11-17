import { useContext, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import type { ServerWithStatusType } from '@/lib/types.ts';

/**
 * 删除服务器二次确认（PRD §5.1「删除」：服务器及其全部历史数据，二次确认）。
 *
 * 删除是级联的（历史监控数据一并删除且无法撤销），确认弹窗里带服务器名称，避免误触；
 * store.deleteServer 成功后已按当前条件刷新列表，这里只补成功提示与跳转回调。
 */

type ServerDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: ServerWithStatusType | null;
  /** 删除成功后的回调（详情页跳回 /servers） */
  onDeleted?: () => void;
};

export const ServerDeleteDialog = observer(({ open, onOpenChange, server, onDeleted }: ServerDeleteDialogProps) => {
  const store = useContext(StoreContext);
  const [submitting, setSubmitting] = useState(false);

  const handleDelete = async () => {
    if (!server || submitting) {
      return;
    }
    setSubmitting(true);

    try {
      const ok = await store.deleteServer(server.id);
      // 失败时留在弹窗里：store 已按后端 message toast，可重试
      if (!ok) {
        return;
      }
      toast.success('服务器已删除', { position: 'top-center' });
      onOpenChange(false);
      onDeleted?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除服务器「{server?.name ?? ''}」？</AlertDialogTitle>
          <AlertDialogDescription>该服务器的全部历史监控数据将一并删除，此操作无法撤销。</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white shadow-xs"
            disabled={submitting}
            onClick={(event) => {
              // 拦截 AlertDialogAction 的默认关闭行为：删除失败时要留在弹窗里重试
              event.preventDefault();
              void handleDelete();
            }}
          >
            {submitting && <Spinner />}
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});
