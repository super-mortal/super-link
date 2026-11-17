import { useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import z from 'zod';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { ServerTokenGuide } from '@/components/Server/ServerTokenGuide.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import { SERVER_DEFAULT_GROUP, SERVER_GROUPS } from '@/lib/serverFormat.ts';
import type { ServerCreateResultType, ServerGroupType, ServerWithStatusType } from '@/lib/types.ts';

/**
 * 添加 / 编辑服务器弹窗（PRD §5.1「新增 / 编辑」，原型 openServerAddModal）。
 *
 * 添加与编辑复用同一弹窗：两边字段（名称 / 备注 / 分组）与校验完全一致，拆成两个只会让
 * zod schema 与提交逻辑复制两份（与 AccountDialog 同一取舍）。
 *
 * 添加成功后的「安装指引态」：Token 明文与含 Token 的一行安装命令只在**同一弹窗内**展示
 * 这一次（store.createServer 的返回即唯一一次完整凭据，PRD §5.6 / D6），关闭弹窗或卸载
 * 组件后内存态立即清理，不写入任何持久化存储；列表 / 详情 / toast 不出现 Token。
 */

/** 长度上限与后端 ServerPayload 对齐（190 / 2000）：前端先拦，少一次无效请求 */
const MAX_NAME_LENGTH = 190;
const MAX_NOTE_LENGTH = 2000;

const serverFormSchema = z.object({
  // trim 先于 min：空白字符名称在前端就被判空（后端同样拒绝）
  name: z
    .string()
    .trim()
    .min(1, { message: '服务器名称不能为空' })
    .max(MAX_NAME_LENGTH, { message: `服务器名称不能超过 ${MAX_NAME_LENGTH} 个字符` }),
  note: z.string().max(MAX_NOTE_LENGTH, { message: `备注不能超过 ${MAX_NOTE_LENGTH} 个字符` }),
  // 分组白名单固定四项（决策 D10）；预选与后端建表默认值一致
  group: z.enum(SERVER_GROUPS),
});

type ServerFormValuesType = z.infer<typeof serverFormSchema>;

type ServerFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑目标；null = 新建 */
  server?: ServerWithStatusType | null;
  /** 编辑保存成功后的回调（详情页重拉详情；列表页不传，store 已按当前条件刷新列表） */
  onSaved?: () => void | Promise<void>;
};

export const ServerFormDialog = observer(({ open, onOpenChange, server = null, onSaved }: ServerFormDialogProps) => {
  const store = useContext(StoreContext);
  const isEdit = server !== null;

  /**
   * 新建成功后的凭据材料（Token 明文 + 安装命令）：只存本组件内存态，弹窗关闭即清理，
   * 不落入 store observable 与 localStorage（PRD §5.6 / D6）。
   */
  const [created, setCreated] = useState<ServerCreateResultType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ServerFormValuesType>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: {
      name: '',
      note: '',
      group: SERVER_DEFAULT_GROUP,
    },
  });

  const serverId = server?.id ?? null;
  // 每次打开重置：新建回空表单，编辑灌入当前值。只按 open 与目标 id 重置——详情页 30s
  // 轮询会生成新的 server 对象引用，把 server 纳入依赖会在用户编辑中途重置表单；
  // 关闭时清理安装指引态，Token 明文不等下次打开
  useEffect(() => {
    if (!open) {
      setCreated(null);
      return;
    }
    form.reset({
      name: server?.name ?? '',
      note: server?.note ?? '',
      group: (server?.group as ServerGroupType | undefined) ?? SERVER_DEFAULT_GROUP,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serverId, form]);

  const handleSubmit = async (values: ServerFormValuesType) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);

    try {
      if (isEdit && server) {
        const ok = await store.updateServer(server.id, {
          name: values.name,
          note: values.note,
          group: values.group,
        });
        // 失败时保持弹窗打开：store 已按后端 message toast，用户改完可直接重试
        if (!ok) {
          return;
        }
        toast.success('服务器已更新', { position: 'top-center' });
        onOpenChange(false);
        await onSaved?.();
        return;
      }

      const result = await store.createServer({
        name: values.name,
        note: values.note,
        group: values.group,
      });
      // 创建失败同样保持打开，避免用户重复点击产生第二台服务器
      if (!result) {
        return;
      }
      // 同一弹窗内切换到安装指引态：Token 明文只在这一个内存态里完整出现
      setCreated(result);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">「{created.server.name}」已创建</DialogTitle>
              <DialogDescription>
                在被监控机器上执行下面的命令，Agent 安装后会自动连接 Hub 并保持长连接。
              </DialogDescription>
            </DialogHeader>

            <ServerTokenGuide token={created.token} installCommand={created.install_command} />

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>完成</Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle className="text-base">{isEdit ? '编辑服务器' : '添加服务器'}</DialogTitle>
                <DialogDescription>
                  {isEdit
                    ? '修改名称、备注或分组；未修改的字段保持原值'
                    : '添加后生成 Agent Token，在被监控机器上执行一行安装命令即可（自动识别架构、注册 systemd 服务）。'}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="gap-1.5">
                      <FormLabel>名称</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="如 Tokyo VPS" autoComplete="off" disabled={submitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem className="gap-1.5">
                      <FormLabel>备注</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder="用途、位置等（可选）"
                          disabled={submitting}
                          className="max-h-40 min-h-16"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="group"
                  render={({ field }) => (
                    <FormItem className="gap-1.5">
                      <FormLabel>分组</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={submitting}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SERVER_GROUPS.map((group) => (
                            <SelectItem key={group} value={group}>
                              {group}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                  取消
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting && <Spinner />}
                  {submitting ? '创建中…' : isEdit ? '保存' : '创建并生成 Token'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
});
