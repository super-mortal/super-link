import * as React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import type { GroupDictItemType } from '@/lib/types';

/**
 * 分组管理卡片（refinements-v0.1.2 §3.3）：账号库 / 服务器两张卡片共用这一份行与弹窗，
 * 差异只有标题、条数单位与三个 CRUD 回调（由 SettingsGroups 注入），避免复制粘贴。
 *
 * 交互约定：
 * - 删除非空分组直接拒绝并提示数量（与服务端 400 文案同口径），不发请求；
 * - 只剩一个分组时禁用删除并就地说明「至少保留一个分组」；
 * - 删除空分组二次确认后执行；重命名弹窗打开时全选原名，回车提交、Esc 取消；
 * - 重名 / 失败由后端返回中文 message，统一请求层已 toast，这里不复制一份校验逻辑。
 */
export type GroupManageCardProps = {
  title: string;
  description: string;
  groups: GroupDictItemType[];
  /** 条数单位，如「台服务器」「个账号」 */
  countUnit: string;
  /** 不可管理时的说明（如账号库未初始化）；非空时禁用全部操作 */
  disabledReason?: string | null;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: number, name: string) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
};

export const GroupManageCard = ({
  title,
  description,
  groups,
  countUnit,
  disabledReason = null,
  onCreate,
  onRename,
  onDelete,
}: GroupManageCardProps) => {
  const disabled = disabledReason !== null;
  const [newName, setNewName] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [renamingGroup, setRenamingGroup] = React.useState<GroupDictItemType | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [renaming, setRenaming] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<GroupDictItemType | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const canDelete = groups.length > 1;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();

    const name = newName.trim();
    if (disabled || adding) {
      return;
    }
    if (name === '') {
      toast.error('请输入分组名', { position: 'top-center' });
      return;
    }

    setAdding(true);
    try {
      const ok = await onCreate(name);
      // 成功提示由统一请求层按后端 message 弹出，这里只清空输入框
      if (ok) {
        setNewName('');
      }
    } finally {
      setAdding(false);
    }
  };

  const openRename = (group: GroupDictItemType) => {
    setRenameValue(group.name);
    setRenamingGroup(group);
  };

  const handleRename = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!renamingGroup || renaming) {
      return;
    }

    const name = renameValue.trim();
    if (name === '') {
      toast.error('请输入分组名', { position: 'top-center' });
      return;
    }
    // 名称没变就直接关闭，不发一次无意义的 PATCH
    if (name === renamingGroup.name) {
      setRenamingGroup(null);
      return;
    }

    setRenaming(true);
    try {
      const ok = await onRename(renamingGroup.id, name);
      if (ok) {
        setRenamingGroup(null);
      }
    } finally {
      setRenaming(false);
    }
  };

  /** 删除前置拦截：最后一个分组 / 非空分组都不发请求，直接给出可归因的中文提示 */
  const requestDelete = (group: GroupDictItemType) => {
    if (disabled) {
      return;
    }
    if (!canDelete) {
      toast.error('至少保留一个分组', { position: 'top-center' });
      return;
    }
    if (group.count > 0) {
      toast.error(`分组「${group.name}」下还有 ${group.count} ${countUnit}，请先移出后再删除`, {
        position: 'top-center',
      });
      return;
    }

    setDeleteTarget(group);
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) {
      return;
    }

    setDeleting(true);
    try {
      const ok = await onDelete(deleteTarget.id);
      // 失败时留在确认框里：后端 message 已由统一请求层 toast，可重试
      if (ok) {
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <span>{title}</span>
          <Badge variant="secondary" className="ml-auto font-normal">
            {groups.length} 个分组 · {total} {countUnit}
          </Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {disabledReason && <p className="text-muted-foreground text-sm">{disabledReason}</p>}

        <div className="no-scrollbar flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {disabled ? '分组列表暂不可用。' : '暂无分组，添加一个开始使用。'}
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.id}
                className="hover:bg-accent/40 flex items-center gap-2 rounded-md border px-3 py-2 transition-colors"
              >
                <span className="min-w-0 flex-1 truncate text-sm" title={group.name}>
                  {group.name}
                </span>
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {group.count} {countUnit}
                </Badge>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`重命名分组 ${group.name}`}
                    disabled={disabled || renaming}
                    onClick={() => openRename(group)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除分组 ${group.name}`}
                    title={canDelete ? undefined : '至少保留一个分组'}
                    disabled={disabled || !canDelete || deleting}
                    onClick={() => requestDelete(group)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <form className="flex items-center gap-2" onSubmit={(event) => void handleAdd(event)}>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="新分组名称"
            aria-label={`新增${title}名称`}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || adding}
          />
          <Button type="submit" disabled={disabled || adding}>
            {adding ? <Spinner /> : <Plus />}
            添加
          </Button>
        </form>

        {!canDelete && groups.length > 0 && (
          <p className="text-muted-foreground text-xs">至少保留一个分组，删除按钮暂不可用。</p>
        )}
      </CardContent>

      {/* 重命名弹窗：autoFocus + onFocus 选中全部原名，直接输入即替换 */}
      <Dialog open={renamingGroup !== null} onOpenChange={(open) => !open && !renaming && setRenamingGroup(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base">重命名分组</DialogTitle>
            <DialogDescription>
              {title}改名后，组内数据自动跟随（{renamingGroup?.count ?? 0} {countUnit}）。
            </DialogDescription>
          </DialogHeader>

          <form className="flex flex-col gap-4" onSubmit={(event) => void handleRename(event)}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="group-rename-input">分组名称</Label>
              <Input
                id="group-rename-input"
                value={renameValue}
                autoFocus
                onFocus={(event) => event.target.select()}
                onChange={(event) => setRenameValue(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={renaming}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setRenamingGroup(null)} disabled={renaming}>
                取消
              </Button>
              <Button type="submit" disabled={renaming}>
                {renaming && <Spinner />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除空分组二次确认 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分组「{deleteTarget?.name ?? ''}」？</AlertDialogTitle>
            <AlertDialogDescription>该分组下没有数据，删除后不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white shadow-xs"
              disabled={deleting}
              onClick={(event) => {
                // 拦截默认关闭：删除失败时要留在弹窗里重试
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deleting && <Spinner />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
