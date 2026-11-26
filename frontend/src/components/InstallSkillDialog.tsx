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
import { InstallSkillProgress } from '@/components/InstallSkillProgress.tsx';
import { cn } from '@/lib/utils.ts';
import type { SkillInstallPhaseType } from '@/lib/skillInstall.ts';
import type { SkillInstallTaskType } from '@/lib/types.ts';

/** 与服务端 SL-IO-0001 的 32MB 上限保持一致，超限在前端先拦，避免白传 */
const MAX_ARCHIVE_SIZE = 32 * 1024 * 1024;

/** 安装进度轮询间隔：1.5s 兼顾阶段回写的及时性与请求量 */
const POLL_INTERVAL_MS = 1500;

/**
 * 前端轮询上限 10 分钟，与后端 worker 的任务超时
 * （SkillInstallTaskPayload::TIMEOUT_MINUTES = 10）保持一致，
 * 避免网络持续失败时无限轮询。超时不等于失败：任务可能仍在后台执行。
 */
const POLL_MAX_DURATION_MS = 10 * 60 * 1000;

type InstallTabType = 'github' | 'upload';

/**
 * GitHub 安装进度态（refinements-v0.1.2 §4.4 方案 B）
 *
 * 已用时长统一取后端 elapsed_seconds：服务端按任务 created_at 实时计算，
 * 比前端本地起算更准确（建任务与拿到响应之间有时间差，且刷新后仍连续）。
 */
type InstallProgressStateType = {
  taskId: number;
  phase: SkillInstallPhaseType;
  stage: string;
  elapsedSeconds: number;
  message: string;
  skillName: string;
  sourceUrl: string;
};

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
  /** 上传压缩包与建任务的 loading（上传流程保持原有同步行为，不走进度轮询） */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** GitHub 安装：POST 建任务期间的 loading */
  const [isStarting, setIsStarting] = useState(false);
  /** GitHub 安装：任务进度态（null 表示还在表单态） */
  const [progress, setProgress] = useState<InstallProgressStateType | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 每次打开都回到初始态：GitHub tab、清空历史输入与进度、聚焦 URL 框
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setTab('github');
    setUrl('');
    setFile(null);
    setIsDragging(false);
    setIsSubmitting(false);
    setIsStarting(false);
    setProgress(null);
    const timer = window.setTimeout(() => urlInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const progressTaskId = progress?.taskId ?? null;
  // 进行中的布尔值而非具体 phase：pending → running 的切换不应重建定时器 / 重置超时起点
  const progressActive = progress?.phase === 'pending' || progress?.phase === 'running';

  /**
   * 安装任务轮询：弹窗关闭、任务结束或组件卸载时清定时器。
   * 依赖只取 taskId / 是否进行中两个基元值，阶段与时长更新不会重建定时器。
   */
  useEffect(() => {
    if (!isOpen || progressTaskId === null || !progressActive) {
      return;
    }

    const taskId = progressTaskId;
    const startedAt = Date.now();
    // 本地停止标记：轮询请求返回前就已结束 / 组件已清理时，丢弃迟到响应
    let stopped = false;

    const applyTask = (task: SkillInstallTaskType): boolean => {
      const base = {
        taskId,
        stage: task.stage,
        elapsedSeconds: task.elapsed_seconds,
        message: task.message,
        skillName: task.skill_name,
        sourceUrl: task.source_url,
      };

      if (task.status === 'success') {
        setProgress({ ...base, phase: 'success' });
        // 成功后刷新列表并高亮新装 Skill（与旧同步安装的体验一致）
        void store.fetchSkills().then(() => {
          if (task.skill) {
            store.markSkillJustInstalled(task.skill.id);
          }
        });
        return true;
      }

      if (task.status === 'failed') {
        setProgress({ ...base, phase: 'failed' });
        return true;
      }

      setProgress({ ...base, phase: task.status });
      return false;
    };

    const tick = async () => {
      if (stopped) {
        return;
      }

      if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
        stopped = true;
        setProgress((prev) =>
          prev && prev.taskId === taskId
            ? {
                ...prev,
                phase: 'timeout',
                message: '等待安装结果超时（10 分钟）。任务可能仍在后台执行，可稍后刷新列表查看，或关闭后重试。',
              }
            : prev
        );
        return;
      }

      const task = await store.fetchSkillInstallTask(taskId);
      // 单次请求失败不终止轮询，等下一轮；到上限后由上面的超时分支收尾
      if (stopped || !task) {
        return;
      }

      if (applyTask(task)) {
        stopped = true;
      }
    };

    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isOpen, progressTaskId, progressActive, store]);

  const installFromGithub = async () => {
    if (isStarting) {
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      toast.error('请输入 GitHub 仓库地址', { position: 'top-center' });
      urlInputRef.current?.focus();
      return;
    }

    setIsStarting(true);
    try {
      // 契约变化（§4.4 方案 B）：后端立刻返回安装任务，进度与结果走状态端点轮询
      const task = await store.installSkill({ url: trimmedUrl });
      if (!task) {
        return;
      }

      setProgress({
        taskId: task.id,
        phase: task.status,
        stage: task.stage,
        elapsedSeconds: task.elapsed_seconds,
        message: task.message,
        skillName: task.skill_name,
        sourceUrl: task.source_url || trimmedUrl,
      });
    } finally {
      setIsStarting(false);
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

  const retryInstall = () => {
    setProgress(null);
    window.setTimeout(() => urlInputRef.current?.focus(), 0);
  };

  const isProgressRunning = progress?.phase === 'pending' || progress?.phase === 'running';
  const isProgressFinished = progress?.phase === 'success';
  const isProgressStopped = progress?.phase === 'failed' || progress?.phase === 'timeout';

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

        {progress ? (
          <>
            <div className="px-5 py-4">
              <InstallSkillProgress
                phase={progress.phase}
                stage={progress.stage}
                elapsedSeconds={progress.elapsedSeconds}
                message={progress.message}
                skillName={progress.skillName}
                sourceUrl={progress.sourceUrl}
              />
            </div>
            <div className="flex items-center gap-2 border-t px-5 py-3">
              {isProgressRunning && (
                <span className="text-muted-foreground mr-auto text-xs">可关闭弹窗，安装会在后台继续</span>
              )}
              {isProgressStopped && (
                <>
                  <Button variant="outline" size="sm" className="ml-auto" onClick={store.closeInstallSkillDialog}>
                    关闭
                  </Button>
                  <Button size="sm" onClick={retryInstall}>
                    重试
                  </Button>
                </>
              )}
              {isProgressFinished && (
                <Button size="sm" className="ml-auto" onClick={store.closeInstallSkillDialog}>
                  完成
                </Button>
              )}
            </div>
          </>
        ) : (
          <Tabs value={tab} onValueChange={(value) => setTab(value as InstallTabType)} className="gap-0">
            <div className="px-5 pt-4">
              <TabsList className="w-full p-1">
                <TabsTrigger value="github" className="h-8 text-[13px]" disabled={isStarting || isSubmitting}>
                  <Github />从 GitHub 安装
                </TabsTrigger>
                <TabsTrigger value="upload" className="h-8 text-[13px]" disabled={isStarting || isSubmitting}>
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
                disabled={isStarting}
              />
              <InstallHints>
                <HintLine>
                  支持仓库根目录、<span className="font-mono">skills/</span> 子目录或任意下一级目录中的 SKILL.md
                </HintLine>
                <HintLine>安装后保留 .git，可随时检测上游更新并按指纹还原版本</HintLine>
                <HintLine>境内服务器连接 GitHub 失败时，可在「设置 → 网络」配置代理，或改用上传压缩包</HintLine>
                <HintLine>
                  也可粘贴子目录链接，如 <span className="font-mono">github.com/owner/repo/tree/main/skills/xxx</span>
                </HintLine>
              </InstallHints>
              <Button className="mt-4 w-full" onClick={installFromGithub} disabled={isStarting}>
                {isStarting && <Spinner />}
                {isStarting ? '正在创建安装任务…' : '安装'}
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
        )}
      </DialogContent>
    </Dialog>
  );
});
