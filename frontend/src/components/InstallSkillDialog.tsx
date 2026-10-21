import * as React from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Github, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { StoreContext } from '@/store/storeContext.ts';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { cn } from '@/lib/utils.ts';

/** 与服务端 SL-IO-0001 的 32MB 上限保持一致，超限在前端先拦，避免白传 */
const MAX_ARCHIVE_SIZE = 32 * 1024 * 1024;

type InstallTabType = 'github' | 'upload';

/** 提示块：与演示稿的三条圆点列表一致 */
const InstallHints = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-muted/60 text-muted-foreground mt-3 flex flex-col gap-1.5 rounded-md p-3 text-xs leading-relaxed">
    {children}
  </div>
);

const HintLine = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2">
    <span className="bg-muted-foreground/60 mt-1.5 h-1 w-1 shrink-0 rounded-full" />
    <span>{children}</span>
  </div>
);

const formatFileSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const InstallSkillDialog = observer(() => {
  const store = useContext(StoreContext);

  const isOpen = store.isInstallSkillDialogOpen;
  const [tab, setTab] = useState<InstallTabType>('github');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 每次打开都回到初始态：GitHub tab、清空历史输入、聚焦 URL 框
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setTab('github');
    setUrl('');
    setFile(null);
    setIsDragging(false);
    const timer = window.setTimeout(() => urlInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const installFromGithub = async () => {
    if (isSubmitting) {
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      toast.error('请输入 GitHub 仓库地址', { position: 'top-center' });
      urlInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      // 成功 toast 由 runRequest 按后端 message 统一弹出，失败也保持弹窗打开展示错误
      const installed = await store.installSkill({ url: trimmedUrl });
      if (installed) {
        store.closeInstallSkillDialog();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadFile = async (candidate: File | null | undefined) => {
    if (!candidate || isSubmitting) {
      return;
    }

    if (!candidate.name.toLowerCase().endsWith('.zip')) {
      toast.error('仅支持 .zip 格式的压缩包', { position: 'top-center' });
      return;
    }
    if (candidate.size > MAX_ARCHIVE_SIZE) {
      toast.error('压缩包不能超过 32MB', { position: 'top-center' });
      return;
    }

    setFile(candidate);
    setIsSubmitting(true);
    try {
      const installed = await store.uploadSkill(candidate);
      if (installed) {
        store.closeInstallSkillDialog();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void uploadFile(event.dataTransfer.files?.[0]);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (next) {
          store.openInstallSkillDialog();
        } else {
          store.closeInstallSkillDialog();
        }
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          urlInputRef.current?.focus();
        }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <DialogTitle className="text-[15px] font-semibold">安装 Skill</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="关闭">
              <X />
            </Button>
          </DialogClose>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as InstallTabType)} className="gap-0">
          <div className="px-5 pt-4">
            <TabsList className="w-full p-1">
              <TabsTrigger value="github" className="h-8 text-[13px]" disabled={isSubmitting}>
                <Github />从 GitHub 安装
              </TabsTrigger>
              <TabsTrigger value="upload" className="h-8 text-[13px]" disabled={isSubmitting}>
                <Upload />
                上传压缩包
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="github" className="px-5 py-4">
            <label htmlFor="install-skill-url" className="text-[13px] font-medium">
              GitHub 仓库地址
            </label>
            <Input
              id="install-skill-url"
              ref={urlInputRef}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void installFromGithub();
                }
              }}
              placeholder="https://github.com/owner/repo 或 owner/repo"
              className="mt-1.5"
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
            />
            <InstallHints>
              <HintLine>
                支持仓库根目录、<span className="font-mono">skills/</span> 子目录或任意下一级目录中的 SKILL.md
              </HintLine>
              <HintLine>安装后保留 .git，可随时检测上游更新并按指纹还原版本</HintLine>
              <HintLine>
                也可粘贴子目录链接，如 <span className="font-mono">github.com/owner/repo/tree/main/skills/xxx</span>
              </HintLine>
            </InstallHints>
            <Button className="mt-4 w-full" onClick={installFromGithub} disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? '安装中…' : '安装'}
            </Button>
          </TabsContent>

          <TabsContent value="upload" className="px-5 py-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                // 允许再次选择同一个文件（失败后重试时不会触发 change）
                event.target.value = '';
                void uploadFile(picked);
              }}
            />
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                if (!isSubmitting) {
                  setIsDragging(true);
                }
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'hover:bg-muted/30 flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-9 text-center transition',
                isDragging && 'border-ring bg-muted/50',
                isSubmitting && 'cursor-progress opacity-70'
              )}
            >
              <div className="pointer-events-none flex flex-col items-center">
                <div className="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full">
                  {isSubmitting ? <Spinner className="size-5" /> : <Upload className="size-5" />}
                </div>
                <p className="mt-3 text-[13px]">{isSubmitting ? '安装中…' : '点击选择，或将 .zip 拖拽到此处'}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {file
                    ? `${file.name} · ${formatFileSize(file.size)}`
                    : '解压后存放于 storage/skills/，可像书签一样打标签管理'}
                </p>
              </div>
            </button>
            <InstallHints>
              <HintLine>压缩包根目录或一级子目录中需包含 SKILL.md</HintLine>
              <HintLine>单个文件不超过 32MB，仅支持 .zip 格式</HintLine>
              <HintLine>上传来源无上游更新检测，重复上传同名 skill 将覆盖</HintLine>
            </InstallHints>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
});
