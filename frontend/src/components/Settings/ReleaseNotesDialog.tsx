import * as React from 'react';
import { Check, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
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
import { UPDATE_RESULT_KEY } from '@/store/mainStore.ts';
import { observer } from 'mobx-react-lite';

/** Markdown 行内元素对应的类名：集中定义，便于统一调整与 Tailwind 扫描 */
const MD_CODE_CLASS = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]';
const MD_LINK_CLASS = 'text-primary underline underline-offset-2';

/**
 * 把 GitHub Release 的 body（Markdown 原文）渲染为 HTML 字符串。
 *
 * 只支持发布说明约定的小子集：`#` / `##` / `###` 标题、`-` / `*` 列表、段落、
 * 行内代码（反引号）、加粗（`**x**`）与行内链接。
 * 安全：所有文本先整体 HTML 转义，再套行内代码 / 加粗 / 链接；链接只放行 http/https 协议并统一
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

  /**
   * 行内渲染：先把反引号代码段切出来单独处理，其余文本整体转义后再套加粗与链接。
   * 先切代码段是为了让 `` `**x**` `` 里的星号保持原样，不被当成加粗。
   */
  const renderInline = (text: string): string =>
    text
      .split(/(`[^`]+`)/g)
      .map((part) => {
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return `<code class="${MD_CODE_CLASS}">${escapeHtml(part.slice(1, -1))}</code>`;
        }
        return escapeHtml(part)
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
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
      })
      .join('');

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
    if (line.startsWith('# ')) {
      closeList();
      blocks.push(`<h4 class="mt-4 mb-1 text-base font-semibold first:mt-0">${renderInline(line.slice(2))}</h4>`);
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
    // `-` 与 `*` 都是列表项：GitHub 自动生成的 changelog 用 `*`
    if (line.startsWith('- ') || line.startsWith('* ')) {
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

/* ------------------------------ 应用更新进度 ------------------------------ */

/**
 * 更新过程分四段。前三段无法从 Watchtower 获得真实进度（异步触发端点不返回进度，
 * 且容器重建期后端整体不可达），因此进度条为时间估计；第四段之后由轮询
 * /api/app-info 的 installed_version 变化作为唯一成功信号，保证「走完 = 真成功」。
 */
const UPDATE_STAGES = [
  { label: '正在提交更新请求…', from: 0, to: 8 },
  { label: '正在拉取新镜像…', from: 8, to: 40 },
  { label: '正在重建应用容器…', from: 40, to: 65 },
  { label: '正在等待服务就绪…', from: 65, to: 95 },
];

/** 前三个阶段的预计耗时（秒），仅用于让进度平滑推进，不代表真实下载进度 */
const STAGE_SECONDS = [1, 40, 25];
/** 总超时（秒）：境内从 GHCR 拉取镜像可能较慢，阈值需留足余量 */
const UPDATE_TIMEOUT_SEC = 600;
/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 3000;
/** 进度条推进间隔（毫秒）：配合 CSS transition，500ms 已足够平滑 */
const TICK_INTERVAL_MS = 400;

type UpdatePhase = 'idle' | 'running' | 'success' | 'failed';
/** 失败原因：服务可达但版本未变 / 一直连不上 */
type FailReason = 'no-change' | 'unreachable';

/**
 * 按已耗时估算进度百分比与当前阶段。
 * 前三阶段用 easeOut 插值（前快后慢），走完预计时长后停在第四阶段起点，交给轮询推进。
 */
function estimateProgress(elapsedSec: number): { percent: number; stageIndex: number } {
  let acc = 0;
  for (let i = 0; i < STAGE_SECONDS.length; i += 1) {
    const duration = STAGE_SECONDS[i];
    if (elapsedSec < acc + duration) {
      const ratio = (elapsedSec - acc) / duration;
      const eased = 1 - Math.pow(1 - ratio, 2);
      const stage = UPDATE_STAGES[i];
      return { percent: stage.from + (stage.to - stage.from) * eased, stageIndex: i };
    }
    acc += duration;
  }
  return { percent: UPDATE_STAGES[3].from, stageIndex: 3 };
}

/** 进度条：与弹窗内容同宽，数值变化由 CSS transition 平滑过渡 */
const UpdateProgressBar = ({ percent }: { percent: number }) => (
  <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
    <div
      className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
    />
  </div>
);

type ReleaseNotesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 触发更新：调用 store.updateApp()，返回 false 表示后端触发失败 */
  onConfirmUpdate: () => Promise<boolean>;
};

/**
 * 更新内容弹窗（PRD O-4）：展示最新版本号、发布时间与 Markdown 渲染的更新说明。
 * 点击「立即更新」在弹窗内原地切换为进度态，更新期间不可关闭（避免容器重建期刷新导致 502）；
 * 进度完成以 installed_version 真的变化为准，随后自动刷新并在新页面提示结果。
 */
export const ReleaseNotesDialog = observer(({ open, onOpenChange, onConfirmUpdate }: ReleaseNotesDialogProps) => {
  const store = React.useContext(StoreContext);
  const [phase, setPhase] = React.useState<UpdatePhase>('idle');
  const [percent, setPercent] = React.useState(0);
  const [stageIndex, setStageIndex] = React.useState(0);
  const [failReason, setFailReason] = React.useState<FailReason>('unreachable');

  const tickTimer = React.useRef<number | undefined>(undefined);
  const pollTimer = React.useRef<number | undefined>(undefined);
  const reloadTimer = React.useRef<number | undefined>(undefined);
  // 最后一次轮询是否成功拿到响应：决定失败态文案（服务可达但版本未变 / 一直连不上）
  const lastPollOk = React.useRef(false);
  const startAt = React.useRef(0);

  const release = store.appInfo?.latest_release ?? null;
  const installedVersion = store.appInfo?.installed_version ?? null;
  const latestVersion = store.appInfo?.latest_version ?? null;
  const publishedAt = formatReleaseDate(release?.published_at);
  const releaseUrl = release?.html_url ?? null;
  const body = release?.body?.trim() ?? '';

  const stopTimers = React.useCallback(() => {
    if (tickTimer.current !== undefined) window.clearInterval(tickTimer.current);
    if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current);
    if (reloadTimer.current !== undefined) window.clearTimeout(reloadTimer.current);
    tickTimer.current = undefined;
    pollTimer.current = undefined;
    reloadTimer.current = undefined;
  }, []);

  React.useEffect(() => stopTimers, [stopTimers]);

  /** 判定成功：写入一次性结果供刷新后提示，1.2 秒后整页刷新 */
  const succeed = React.useCallback(
    (nextVersion: string, fromVersion: string | null) => {
      stopTimers();
      setPercent(100);
      setStageIndex(3);
      setPhase('success');
      try {
        sessionStorage.setItem(UPDATE_RESULT_KEY, JSON.stringify({ from: fromVersion, to: nextVersion }));
      } catch {
        // sessionStorage 不可用（隐私模式等）时放弃成功提示，不影响更新本身
      }
      reloadTimer.current = window.setTimeout(() => window.location.reload(), 1200);
    },
    [stopTimers]
  );

  const fail = React.useCallback(
    (reason: FailReason) => {
      stopTimers();
      setFailReason(reason);
      setPhase('failed');
    },
    [stopTimers]
  );

  const beginUpdate = async () => {
    stopTimers();
    const fromVersion = store.appInfo?.installed_version ?? null;
    lastPollOk.current = false;
    startAt.current = Date.now();
    setPercent(0);
    setStageIndex(0);
    setPhase('running');

    // 进度推进：纯时间估计，封顶到第四阶段起点（65%），再交给轮询
    tickTimer.current = window.setInterval(() => {
      const elapsed = (Date.now() - startAt.current) / 1000;
      const est = estimateProgress(elapsed);
      setPercent((prev) => Math.max(prev, est.percent));
      setStageIndex(est.stageIndex);
      if (elapsed > UPDATE_TIMEOUT_SEC) {
        fail(lastPollOk.current ? 'no-change' : 'unreachable');
      }
    }, TICK_INTERVAL_MS);

    // 轮询：唯一成功判据是 installed_version 与更新前不同；
    // 请求失败代表容器正在重建（此时后端不可达），属正常情况，保持当前进度。
    pollTimer.current = window.setInterval(async () => {
      const data = await store.getAppInfo();
      const currentPhase = pollTimer.current;
      if (currentPhase === undefined) {
        return; // 已结束（成功 / 失败 / 卸载），避免继续 setState
      }
      if (!data) {
        lastPollOk.current = false;
        return;
      }
      lastPollOk.current = true;
      const installed = data.installed_version as string | null;
      if (installed && fromVersion && installed !== fromVersion) {
        succeed(installed, fromVersion);
        return;
      }
      setPercent((prev) => Math.min(Math.max(prev, UPDATE_STAGES[3].from) + 2, 95));
    }, POLL_INTERVAL_MS);

    try {
      const triggered = await onConfirmUpdate();
      if (!triggered) {
        fail('unreachable');
      }
    } catch {
      // 触发链路异常（网络中断、后端 500 等）：统一落到失败态，允许重试
      fail('unreachable');
    }
  };

  /** 关闭请求：进度 / 成功态一律拒绝，避免用户在容器重建期刷新页面 */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (phase === 'running' || phase === 'success') {
        return;
      }
      setPhase('idle');
      setPercent(0);
      setStageIndex(0);
    }
    onOpenChange(next);
  };

  const locked = phase === 'running' || phase === 'success';
  const stageLabel = phase === 'success' ? '更新完成' : UPDATE_STAGES[stageIndex].label;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]" showCloseButton={!locked}>
        <DialogHeader>
          <DialogTitle className="text-base">{phase === 'failed' ? '更新可能未完成' : '更新内容'}</DialogTitle>
          <DialogDescription>
            {latestVersion ? `v${latestVersion}` : '新版本'}
            {publishedAt ? ` · 发布于 ${publishedAt}` : ''}
            {installedVersion ? ` · 当前 v${installedVersion}` : ''}
          </DialogDescription>
        </DialogHeader>

        {phase === 'failed' ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm leading-relaxed">
            {failReason === 'no-change'
              ? '当前已在最新版本，或新镜像尚未发布到 latest。可重试，或稍后手动检查更新。'
              : '未能连接应用服务，容器可能仍在重启。可稍等后手动刷新页面确认，或重试一次更新。'}
          </p>
        ) : phase === 'idle' ? (
          body ? (
            <div
              className="no-scrollbar max-h-[50vh] overflow-y-auto rounded-md border p-3 text-sm leading-relaxed"
              // body 是 GitHub Release 的 Markdown 原文：renderReleaseMarkdown 已整体转义并只放行
              // http/https 链接，渲染结果才能安全地作为 HTML 注入
              dangerouslySetInnerHTML={{ __html: renderReleaseMarkdown(body) }}
            />
          ) : (
            // 降级：GitHub 不可达或该 release 未填写说明时，保留发布页外链与更新入口
            <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
              暂时无法获取更新说明，可点击下方「查看完整发布页」了解本次变更。
            </p>
          )
        ) : (
          // 进度态 / 成功态
          <div className="flex flex-col gap-4 py-2">
            <div className="flex items-center gap-2.5">
              {phase === 'success' ? (
                <Check className="text-primary size-4 shrink-0" />
              ) : (
                <Spinner className="text-primary size-4 shrink-0" />
              )}
              <span className="text-sm font-medium">{stageLabel}</span>
              <span className="text-muted-foreground ml-auto text-xs tabular-nums">{Math.round(percent)}%</span>
            </div>
            <UpdateProgressBar percent={percent} />
            <p className="text-muted-foreground text-xs leading-relaxed">
              {phase === 'success'
                ? '页面即将自动刷新，无需手动操作。'
                : '重启期间页面可能短暂无法访问，属正常现象。请不要关闭页面。'}
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {phase === 'idle' && (
            <>
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
                <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                  稍后
                </Button>
                <Button size="sm" onClick={() => void beginUpdate()}>
                  <RefreshCw />
                  立即更新
                </Button>
              </div>
            </>
          )}

          {phase === 'failed' && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                关闭
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleOpenChange(false);
                    toast(`当前版本 v${installedVersion ?? '未知'}`, { position: 'top-center' });
                  }}
                >
                  查看当前版本
                </Button>
                <Button size="sm" onClick={() => void beginUpdate()}>
                  <RefreshCw />
                  重试
                </Button>
              </div>
            </>
          )}

          {locked && (
            <span className="text-muted-foreground w-full text-center text-xs">更新进行中，请勿关闭页面。</span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
