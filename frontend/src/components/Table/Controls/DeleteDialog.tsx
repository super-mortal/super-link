import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog.tsx';
import React from 'react';

type DeleteDialogProps = {
  /** 确认删除的回调；异步实现允许返回 Promise */
  onConfirm: () => void | Promise<void>;
  itemsCount: number;
  /** 量词名词：书签为「项目」，Skill 为「Skill」 */
  noun?: string;
  /** 触发按钮 / 菜单项 */
  children: React.ReactNode;
};

export const DeleteDialog = ({ onConfirm, itemsCount, noun = '项目', children }: DeleteDialogProps) => {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除{itemsCount === 1 ? noun : `${itemsCount} 个${noun}`}？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作无法撤销。{itemsCount === 1 ? `该${noun}` : `这些${noun}`}将被永久删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col-reverse sm:flex-row">
          <AlertDialogCancel className="mt-2 sm:mt-0">取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white shadow-xs"
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
