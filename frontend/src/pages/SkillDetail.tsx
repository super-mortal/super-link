import { type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  Download,
  File as FileIcon,
  FileQuestion,
  FileText,
  Folder,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { StoreContext } from '@/store/storeContext.ts';
import { Dashboard } from '@/layouts/Dashboard.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Separator } from '@/components/ui/separator.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';
import { DeleteDialog } from '@/components/Table/Controls/DeleteDialog.tsx';
import { SourceBadge, UpdateBadge } from '@/components/Table/Fields/SourceBadge.tsx';
import { normalizedSourceURL } from '@/components/Table/Fields/moduleItem.ts';
import { TagPath } from '@/components/EditItem/TagPath.tsx';
import { SidebarToggler } from '@/components/Sidebar/SidebarToggler.tsx';
import { cn, getColorClass, normalizeQuery } from '@/lib/utils.ts';
import type { SkillDetailType } from '@/lib/types.ts';

/** 本机最近一次检查时间按 Skill 记录，仅存 sessionStorage（刷新页面仍可见，关浏览器即清） */
const LAST_CHECK_STORAGE_PREFIX = 'sl-skill-last-check-';

/** 新建标签后随机换色只用后端支持的色板 key（与 utils.colorMap 一致） */
const RANDOM_TAG_COLORS = ['gray', 'green', 'red', 'yellow', 'aqua', 'black'] as const;

type PendingActionType = 'check' | 'update' | 'export' | 'delete' | null;

const pad = (value: number) => String(value).padStart(2, '0');

const formatNow = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const readLastCheck = (skillID: number): string | null => {
  try {
    return window.sessionStorage.getItem(`${LAST_CHECK_STORAGE_PREFIX}${skillID}`);
  } catch {
    return null;
  }
};

const writeLastCheck = (skillID: number, value: string): void => {
  try {
    window.sessionStorage.setItem(`${LAST_CHECK_STORAGE_PREFIX}${skillID}`, value);
  } catch {
    // 隐私模式下 sessionStorage 可能不可写，最近检查时间降级为不展示
  }
};

/** SKILL.md 渲染样式：全部走语义色，明暗主题共用一套（不开启 raw HTML） */
const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mt-5 mb-2 text-[15px] leading-6 font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-5 mb-2 text-[14px] leading-6 font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-1.5 text-[13.5px] leading-6 font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 text-[13px] leading-6 font-semibold">{children}</h4>,
  p: ({ children }) => <p className="text-muted-foreground my-2 text-[13px] leading-7">{children}</p>,
  ul: ({ children }) => (
    <ul className="text-muted-foreground my-2 list-disc space-y-1 pl-5 text-[13px] leading-7">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="text-muted-foreground my-2 list-decimal space-y-1 pl-5 text-[13px] leading-7">{children}</ol>
  ),
  li: ({ children, className }) => <li className={cn('leading-7 marker:text-current', className)}>{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary decoration-primary/40 underline underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-foreground italic">{children}</em>,
  del: ({ children }) => <del className="opacity-70">{children}</del>,
  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground border-primary/40 my-3 border-l-2 pl-3 italic">{children}</blockquote>
  ),
  code: ({ className, children }) => (
    <code className={cn('bg-muted rounded px-1.5 py-0.5 font-mono text-[12px] break-all', className)}>{children}</code>
  ),
  pre: ({ children }) => (
    // 代码块两套主题都保持深色底：浅色用 foreground 反色，深色用 muted，均为语义 token
    <pre className="bg-foreground text-background dark:bg-muted dark:text-foreground my-3 overflow-x-auto rounded-md p-4 text-[12.5px] leading-6 [&>code]:bg-transparent [&>code]:p-0 [&>code]:break-normal">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60 text-foreground">{children}</thead>,
  th: ({ children }) => <th className="border-b px-3 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="text-muted-foreground border-b px-3 py-1.5 align-top">{children}</td>,
  hr: () => <hr className="my-4 border-t" />,
  img: ({ src, alt }) => <img src={src} alt={alt ?? ''} className="my-3 max-w-full rounded-md border" />,
};

/** 右栏基本信息的一行：标签左，值右（值可省略号截断或换行） */
const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-3">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="min-w-0 text-right">{children}</span>
  </div>
);

const NO_UPSTREAM_HINT = '上传来源无上游更新';

/**
 * 上传来源没有上游仓库：检查更新 / 更新到最新两个按钮必须前置禁用，
 * 而不是等后端返回 SL-SKL-0005。
 */
const NoUpstreamGuard = ({ guarded, children }: { guarded: boolean; children: ReactNode }) => {
  if (!guarded) {
    return <>{children}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* 禁用按钮不产生 pointer 事件，包一层 span 才能触发悬浮提示 */}
        <span tabIndex={0} className="inline-flex cursor-not-allowed" title={NO_UPSTREAM_HINT}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{NO_UPSTREAM_HINT}</TooltipContent>
    </Tooltip>
  );
};

/** 添加标签弹窗：输入框回车即建/复用，下方列出全部现有标签可点选 */
const AddTagPopover = observer(
  ({
    selectedTagIDs,
    onChange,
    disabled,
  }: {
    selectedTagIDs: number[];
    onChange: (nextTagIDs: number[]) => void | Promise<void>;
    disabled: boolean;
  }) => {
    const store = useContext(StoreContext);
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const toggleTag = (tagID: number) => {
      const next = selectedTagIDs.includes(tagID)
        ? selectedTagIDs.filter((id) => id !== tagID)
        : [...selectedTagIDs, tagID];

      void onChange(next);
    };

    const submitQuery = async () => {
      const normalized = normalizeQuery(query);
      if (normalized === '' || isCreating) {
        return;
      }

      // 同名标签（含层级路径）直接复用，不重复创建
      const existing = store.tagsArray.find((tag) => tag.fullPath.toLowerCase() === normalized.toLowerCase());
      if (existing) {
        if (!selectedTagIDs.includes(existing.id)) {
          await onChange([...selectedTagIDs, existing.id]);
        }
        setQuery('');
        return;
      }

      setIsCreating(true);
      try {
        const createdID = await store.createTag(normalized);
        if (createdID === null) {
          return;
        }
        // 新建标签默认是灰色，随机换一个色板让标签树保持区分度（复用现有改色动作）
        const color = RANDOM_TAG_COLORS[Math.floor(Math.random() * RANDOM_TAG_COLORS.length)];
        await store.onChangeTagColor(createdID, color);
        await onChange([...selectedTagIDs, createdID]);
        setQuery('');
      } finally {
        setIsCreating(false);
      }
    };

    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus className="size-3" />
            添加标签
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitQuery();
              }
            }}
            placeholder="输入标签名，回车添加"
            className="h-8 text-xs"
            disabled={isCreating}
            autoComplete="off"
          />
          <Separator className="my-2" />
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {store.tagsArray.length === 0 ? (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">暂无标签</p>
            ) : (
              store.tagsArray.map((tag) => {
                const isSelected = selectedTagIDs.includes(tag.id);

                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleTag(tag.id)}
                    className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors"
                  >
                    <TagPath tag={{ label: tag.fullPath, color: tag.color }} />
                    {isSelected && <Check className="text-primary ml-auto size-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);

const DetailSkeleton = () => (
  <Dashboard>
    <div className="h-full overflow-y-auto p-5">
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="rounded-lg border p-5">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="mt-3 h-3.5 w-full max-w-xl" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[520px] lg:col-span-2" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </div>
  </Dashboard>
);

export const SkillDetail = observer(() => {
  const store = useContext(StoreContext);
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const skillID = Number(params.skillID);

  const [detail, setDetail] = useState<SkillDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingActionType>(null);
  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsLoading(true);
      }

      const result = await store.fetchSkillDetail(skillID);

      if (result !== null) {
        setDetail(result);
      } else if (!silent) {
        setDetail(null);
      }

      if (!silent) {
        setIsLoading(false);
      }
    },
    [store, skillID]
  );

  useEffect(() => {
    if (store.module !== 'skills') {
      store.setModule('skills');
    }
  }, [store, store.module]);

  useEffect(() => {
    void store.fetchTags();
    setLastCheckAt(readLastCheck(skillID));
  }, [store, skillID]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  // 直接进入详情（非列表跳转）时没有历史记录，退回列表页
  const goBack = () => {
    if (location.key === 'default') {
      navigate('/');
      return;
    }
    navigate(-1);
  };

  const goToList = () => navigate('/');

  const checkUpdates = async () => {
    setPendingAction('check');
    try {
      // 只检查当前的这一个 Skill，避免顺带刷新其它行的 hasUpdate
      const updates = await store.checkSkillUpdates([skillID]);
      if (updates === null) {
        return;
      }
      const stamp = formatNow();
      writeLastCheck(skillID, stamp);
      setLastCheckAt(stamp);

      toast(updates.some((update) => update.id === skillID) ? '该 Skill 有新版本可用' : '该 Skill 已是最新版本', {
        position: 'top-center',
      });
    } finally {
      setPendingAction(null);
    }
  };

  const updateToLatest = async () => {
    setPendingAction('update');
    try {
      const updated = await store.updateSkill(skillID);
      if (!updated) {
        return;
      }
      // 成功后刷新详情与列表（hasUpdate 由 store.skills 派生，刷新后自然消失）
      await loadDetail(true);
      await store.fetchSkills();
    } finally {
      setPendingAction(null);
    }
  };

  const exportSkill = async () => {
    setPendingAction('export');
    try {
      await store.exportSkill(skillID);
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    setPendingAction('delete');
    try {
      const deleted = await store.deleteSkills([skillID]);
      if (deleted) {
        goToList();
      }
    } finally {
      setPendingAction(null);
    }
  };

  const applyTags = async (nextTagIDs: number[]) => {
    if (!detail) {
      return;
    }

    const updated = await store.updateSkillTags([detail.skill.id], nextTagIDs);
    if (!updated) {
      return;
    }

    setDetail({ ...detail, skill: { ...detail.skill, tags: nextTagIDs } });
  };

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!detail) {
    return (
      <Dashboard>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <FileQuestion className="text-muted-foreground size-10" />
          <h1 className="text-lg font-semibold">Skill 不存在</h1>
          <p className="text-muted-foreground text-sm">该 Skill 可能已被删除，或链接有误。</p>
          <Button variant="outline" onClick={goToList} className="mt-2">
            <ArrowLeft />
            返回 Skill 列表
          </Button>
        </div>
      </Dashboard>
    );
  }

  const { skill, content, files } = detail;
  const tagIDs = skill.tags ?? [];
  const listSkill = store.skills.find((item) => item.id === skill.id);
  const hasUpdate = Boolean(listSkill?.hasUpdate ?? skill.hasUpdate);
  const isBusy = pendingAction !== null;
  const isUpload = skill.source_type !== 'github';

  return (
    <Dashboard>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[1600px] p-5">
          <div className="mb-4 flex items-center gap-2">
            <SidebarToggler />
            <button
              type="button"
              onClick={goBack}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[13px] transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              返回 Skill 列表
            </button>
          </div>

          <div className="bg-card rounded-lg border p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold break-all">{skill.name}</h1>
                  <SourceBadge sourceType={skill.source_type} />
                  {hasUpdate && <UpdateBadge />}
                </div>
                <p className="text-muted-foreground mt-2 max-w-2xl text-[13px] leading-relaxed break-words">
                  {skill.description || '暂无描述'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <NoUpstreamGuard guarded={isUpload}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkUpdates}
                    disabled={isBusy || isUpload}
                    title={isUpload ? NO_UPSTREAM_HINT : undefined}
                  >
                    {pendingAction === 'check' ? <Spinner /> : <RefreshCw />}
                    检查更新
                  </Button>
                </NoUpstreamGuard>
                <NoUpstreamGuard guarded={isUpload}>
                  <Button
                    size="sm"
                    onClick={updateToLatest}
                    disabled={isBusy || isUpload}
                    title={isUpload ? NO_UPSTREAM_HINT : undefined}
                  >
                    {pendingAction === 'update' ? <Spinner /> : <RotateCw />}
                    更新到最新
                  </Button>
                </NoUpstreamGuard>
                <Button variant="outline" size="sm" onClick={exportSkill} disabled={isBusy}>
                  {pendingAction === 'export' ? <Spinner /> : <Download />}
                  导出
                </Button>
                <DeleteDialog onConfirm={handleDelete} itemsCount={1} noun="Skill">
                  <Button variant="destructive" size="sm" disabled={isBusy}>
                    {pendingAction === 'delete' ? <Spinner /> : <Trash2 />}
                    删除
                  </Button>
                </DeleteDialog>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="bg-card rounded-lg border p-5 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2 border-b pb-3">
                <FileText className="text-muted-foreground size-4" />
                <span className="text-[13px] font-medium">SKILL.md</span>
                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">只读预览</span>
              </div>
              {content.trim() === '' ? (
                <p className="text-muted-foreground text-[13px]">暂无 SKILL.md 内容</p>
              ) : (
                <div className="max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {content}
                  </Markdown>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div className="bg-card rounded-lg border p-4">
                <div className="mb-3 text-[13px] font-medium">基本信息</div>
                <div className="flex flex-col gap-2.5 text-[13px]">
                  <InfoRow label="来源">
                    {skill.source_type === 'github' && skill.source_url ? (
                      <a
                        href={normalizedSourceURL(skill.source_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-foreground font-mono text-[12px] break-all underline underline-offset-2"
                      >
                        {skill.source_url}
                      </a>
                    ) : (
                      <span className="text-[12px]">本地上传</span>
                    )}
                  </InfoRow>
                  <InfoRow label="指纹">
                    <span className="font-mono text-[12px] break-all">{skill.fingerprint || '—'}</span>
                  </InfoRow>
                  <InfoRow label="安装时间">
                    <span className="text-[12px]">{skill.installed_at || '—'}</span>
                  </InfoRow>
                  <InfoRow label="最近检查">
                    <span className="text-[12px]">{lastCheckAt ?? '未检查'}</span>
                  </InfoRow>
                </div>
              </div>

              <div className="bg-card rounded-lg border p-4">
                <div className="mb-3 text-[13px] font-medium">标签</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tagIDs.map((tagID) => {
                    const tag = store.tags[tagID];
                    if (!tag) {
                      return null;
                    }

                    return (
                      <Badge
                        key={tagID}
                        variant="outline"
                        className="gap-1.5 py-0.5 pr-1 pl-2 text-[11.5px] font-medium"
                      >
                        <span className={cn('size-2 shrink-0 rounded-full', getColorClass(tag.color))} />
                        <span className="max-w-40 truncate" title={tag.fullPath.replaceAll('\\/', '/')}>
                          {tag.fullPath.replaceAll('\\/', '/')}
                        </span>
                        <button
                          type="button"
                          aria-label={`移除标签 ${tag.title}`}
                          onClick={() => void applyTags(tagIDs.filter((id) => id !== tagID))}
                          className="hover:text-foreground opacity-60 transition-opacity hover:opacity-100"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    );
                  })}
                  <AddTagPopover selectedTagIDs={tagIDs} onChange={applyTags} disabled={isBusy} />
                </div>
              </div>

              <div className="bg-card rounded-lg border p-4">
                <div className="mb-3 text-[13px] font-medium">文件</div>
                <div className="flex flex-col gap-1 text-[13px]">
                  {files.length === 0 ? (
                    <p className="text-muted-foreground px-2 text-xs">暂无文件</p>
                  ) : (
                    files.map((file) => (
                      <button
                        key={file.name}
                        type="button"
                        onClick={() =>
                          toast.info(`暂不支持在线预览 ${file.name.replace(/\/$/, '')}`, { position: 'top-center' })
                        }
                        className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
                      >
                        {file.type === 'dir' ? (
                          <Folder className="text-muted-foreground size-3.5 shrink-0" />
                        ) : (
                          <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
                        )}
                        <span className="min-w-0 truncate font-mono text-[12px]">{file.name}</span>
                        {typeof file.count === 'number' && (
                          <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">
                            {file.count} 个文件
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Dashboard>
  );
});
