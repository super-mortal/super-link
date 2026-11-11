import { useCallback, useState } from 'react';
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
import { preferencesStore } from '@/store/preferencesStore.ts';

/**
 * 复制密码前的二次确认（PRD §7.3，设置项默认关闭）。
 *
 * 为什么需要它：项目明确不做剪贴板定时清空（会覆盖用户其他复制内容，且浏览器无法
 * 可靠控制系统剪贴板），确认弹窗就是「误触复制」的唯一缓冲。默认关闭是因为多数人
 * 觉得它麻烦——把选择权交给设置项。
 *
 * 用法：guard(action) 包住真正的复制动作；返回的 confirmDialog 必须由调用方渲染
 * （hook 只管开关状态，不拥有 DOM 位置）。设置关闭时 guard 直接执行、不弹窗，
 * 对调用方完全透明。
 */
export const useCopyPasswordGuard = () => {
  const [pendingAction, setPendingAction] = useState<(() => void | Promise<void>) | null>(null);

  const guard = useCallback((action: () => void | Promise<void>) => {
    if (!preferencesStore.vaultCopyPasswordConfirm) {
      void action();
      return;
    }
    // 用函数形式 setState：action 每次都是新闭包，直接存值没有意义反而容易被误优化
    setPendingAction(() => action);
  }, []);

  const confirmDialog = (
    <AlertDialog
      open={pendingAction !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPendingAction(null);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>复制密码</AlertDialogTitle>
          <AlertDialogDescription>
            即将把该账号的密码复制到剪贴板。剪贴板可能被其他应用读取，且不会自动清除，确定继续吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const action = pendingAction;
              // 先清状态再执行：避免动作执行期间仍挂着待确认状态
              setPendingAction(null);
              if (action) {
                void action();
              }
            }}
          >
            复制
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { guard, confirmDialog };
};
