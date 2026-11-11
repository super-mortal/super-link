import * as React from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import { observer } from 'mobx-react-lite';

/** Markdown 行内元素对应的类名：集中定义，便于统一调整与 Tailwind 扫描 */
const MD_CODE_CLASS = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]';
const MD_LINK_CLASS = 'text-primary underline underline-offset-2';

/**
 * 把 GitHub Release 的 body（Markdown 原文）渲染为 HTML 字符串。
 *
 * 只支持发布说明约定的小子集：`##` / `###` 标题、`-` 列表、段落、行内代码（反引号）与行内链接。
 * 安全：所有文本先整体 HTML 转义，再套行内代码与链接；链接只放行 http/https 协议并统一
 * `target="_blank" rel="noopener noreferrer"`，因此 body 里的 `<script>`、`<img onerror>`、
 * `javascript:` 链接等都只会作为纯文本展示，不会执行（PRD O-4 验收标准）。
 */
export function renderReleaseMarkdown(markdown: string): string {
  const escapeHtml = (text: string): string =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // 行内代码与链接：入参已转义，反引号内整体作为 code，不再解析其中语法
  const renderInline = (text: string): string =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, `<code class="${MD_CODE_CLASS}">$1</code>`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
        try {
          const parsed = new URL(url, 'https://github.com');
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return match; // 非 http(s) 协议按纯文本展示，不放行
          }
          return `<a class="${MD_LINK_CLASS}" href="${parsed.href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        } catch {
          return match;
        }
      });

  const blocks: string[] = [];
  let inList = false;
  const closeList = (): void => {
    if (inList) {
      blocks.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      closeList();
      continue;
    }
    if (line.startsWith('## ')) {
      closeList();
      blocks.push(`<h4 class="mt-4 mb-1 text-sm font-semibold first:mt-0">${renderInline(line.slice(3))}</h4>`);
      continue;
    }
    if (line.startsWith('### ')) {
      closeList();
      blocks.push(`<h5 class="mt-3 mb-1 text-sm font-medium first:mt-0">${renderInline(line.slice(4))}</h5>`);
      continue;
    }
    if (line.startsWith('- ')) {
      if (!inList) {
        blocks.push('<ul class="my-1 list-disc space-y-0.5 pl-5">');
        inList = true;
      }
      blocks.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    blocks.push(`<p class="my-1">${renderInline(line)}</p>`);
  }
  closeList();

  return blocks.join('');
}

/**
 * GitHub 的 published_at 是 ISO 时间（UTC），只展示日期部分（YYYY-MM-DD）；
 * 缺失或解析失败时返回 null / 原值，由调用方决定降级文案。
 */
export function formatReleaseDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

type ReleaseNotesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 二次确认后触发更新：调用现有 store.updateApp()，成功返回 true（弹窗随即关闭） */
  onConfirmUpdate: () => Promise<boolean>;
};

/**
 * 更新内容弹窗（PRD O-4）：展示最新版本号、发布时间与 Markdown 渲染的更新说明。
 * 「立即更新」必须在本弹窗内二次确认，沿用既有 POST /api/app/update（Watchtower）链路；
 * 「稍后」与右上角关闭只关闭弹窗，不触发任何更新。
 */
export const ReleaseNotesDialog = observer(({ open, onOpenChange, onConfirmUpdate }: ReleaseNotesDialogProps) => {
  const store = React.useContext(StoreContext);
  const [isUpdating, setIsUpdating] = React.useState(false);

  const release = store.appInfo?.latest_release ?? null;
  const installedVersion = store.appInfo?.installed_version ?? null;
  const latestVersion = store.appInfo?.latest_version ?? null;
  const publishedAt = formatReleaseDate(release?.published_at);
  const releaseUrl = release?.html_url ?? null;
  const body = release?.body?.trim() ?? '';

  const handleConfirmUpdate = async () => {
    setIsUpdating(true);
    const triggered = await onConfirmUpdate();
    setIsUpdating(false);
    // 触发失败（store 已弹错误提示）时留在弹窗内，便于重试或改看发布页
    if (triggered) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-base">更新内容</DialogTitle>
          <DialogDescription>
            {latestVersion ? `v${latestVersion}` : '新版本'}
            {publishedAt ? ` · 发布于 ${publishedAt}` : ''}
            {installedVersion ? ` · 当前 v${installedVersion}` : ''}
          </DialogDescription>
        </DialogHeader>

        {body ? (
          <div
            className="max-h-[50vh] overflow-y-auto rounded-md border p-3 text-sm leading-relaxed"
            // body 是 GitHub Release 的 Markdown 原文：renderReleaseMarkdown 已整体转义并只放行
            // http/https 链接，渲染结果才能安全地作为 HTML 注入
            dangerouslySetInnerHTML={{ __html: renderReleaseMarkdown(body) }}
          />
        ) : (
          // 降级：GitHub 不可达或该 release 未填写说明时，保留发布页外链与更新入口
          <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
            暂时无法获取更新说明，可点击下方「查看完整发布页」了解本次变更。
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {releaseUrl ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={releaseUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                查看完整发布页
              </a>
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isUpdating}>
              稍后
            </Button>
            <Button size="sm" onClick={handleConfirmUpdate} disabled={isUpdating}>
              {isUpdating && <Spinner />}
              <RefreshCw />
              立即更新
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
