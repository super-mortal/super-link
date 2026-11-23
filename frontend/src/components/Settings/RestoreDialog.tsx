import * as React from 'react';
import { Check, Info, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { formatServerBytes } from '@/lib/serverFormat';
import type {
  BackupModuleType,
  BackupRestoreItemType,
  BackupRestoreModeType,
  BackupRestoreResultType,
  BackupRestoreSummaryType,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { StoreContext } from '@/store/storeContext';

/**
 * 板块级恢复弹窗（refinements.md §4.3 / §4.4 / §6.3）。
 *
 * 一个组件承载三态：
 * - pick：选文件（本地先校验扩展名 / 大小 / JSON 与 module，再发预检，避免把明显无效的文件传给后端）；
 * - preview：预检分类（新增 / 同名 / 跳过）+ 合并 / 覆盖选择；切换模式必须重新预检，分类可能不同；
 * - result：执行后的逐条结果与成功 / 跳过 / 失败汇总。
 *
 * 恢复是破坏性操作：overwrite 先弹二次确认，确认文案写清「会清空备份外数据」；
 * 服务器覆盖额外说明 Token 与服务器会被备份替换。关闭弹窗即放弃（不保留状态、不写库）。
 *
 * 所有请求都走 mainStore（previewRestore / restoreBackup），组件内不直接 fetch；
 * 预检失败时 store 已按后端 message toast，这里只补一句就地可读的提示。
 */

/** 与 php.ini 的 upload_max_filesize（32M）对齐，超出后 PHP 会直接丢弃上传 */
const MAX_BACKUP_SIZE = 32 * 1024 * 1024;

type RestorePhaseType = 'pick' | 'preview' | 'result';

type ModuleMetaType = {
  title: string;
  pickHint: string;
  mergeHint: string;
  overwriteHint: string;
  /** overwrite 二次确认的后果说明：必须写清不可逆的数据范围 */
  confirmDescription: string;
  /** 仅服务器：备份文件含凭据材料的提示 */
  credentialNotice?: string;
};

const MODULE_META: Record<BackupModuleType, ModuleMetaType> = {
  bookmarks: {
    title: '书签',
    pickHint: '选择 super-link-bookmarks-*.json 备份文件，只包含书签条目与书签标签。',
    mergeHint: '只补缺失项：按网址判重，已存在的书签跳过。',
    overwriteHint: '清空现有书签与书签标签，再按备份重建；Skill 标签不受影响。',
    confirmDescription: '将清空现有书签与书签标签后按备份重建，备份之外的书签会丢失。此操作无法撤销。',
  },
  skills: {
    title: 'Skill',
    pickHint: '选择 super-link-skills-*.json 备份文件，只包含 GitHub 来源的 Skill。',
    mergeHint: '补装缺失项；同名 Skill 按备份来源地址重新拉取最新版本（与覆盖模式一致）。',
    overwriteHint: '同名 Skill 覆盖为最新版本；本地上传的 Skill 不受影响，也不会被删除。',
    confirmDescription: '同名 Skill 会按备份来源地址重新拉取并覆盖为最新版本。此操作无法撤销。',
  },
  servers: {
    title: '服务器',
    pickHint: '选择 super-link-servers-*.json 备份文件，不含历史监控指标。',
    mergeHint: '只补缺失项：同名服务器跳过，不删除现有服务器。',
    overwriteHint: '同名服务器按备份替换，并删除备份之外的服务器与其历史指标。',
    confirmDescription:
      '将删除备份之外的服务器及其全部历史监控数据；同名服务器的配置与 Token 凭据会被备份中的内容替换，旧 Token 立即失效。此操作无法撤销。',
    credentialNotice: '备份文件包含各服务器的 Token 哈希与盐，等同凭据材料，请妥善保管，勿上传到公开网盘或聊天工具。',
  },
};

const ITEM_STATUS_META: Record<
  BackupRestoreItemType['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  new: { label: '新增', variant: 'default' },
  updated: { label: '更新', variant: 'default' },
  same: { label: '已存在', variant: 'outline' },
  skipped: { label: '跳过', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
};

const TONE_CLASS = {
  primary: 'text-primary',
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
} as const;

type StatTone = keyof typeof TONE_CLASS;

const StatPill = ({ label, value, tone = 'default' }: { label: string; value: number; tone?: StatTone }) => (
  <span className="bg-muted/50 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn('font-medium', TONE_CLASS[tone])}>{value}</span>
  </span>
);

/** 逐条结果行：名称过长（书签网址）时截断，失败原因单独占一行展示 */
const RestoreItemRow = ({ item }: { item: BackupRestoreItemType }) => {
  const status = ITEM_STATUS_META[item.status];

  return (
    <div className="bg-card flex items-start justify-between gap-3 rounded-md border px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm" title={item.name}>
        {item.name}
      </span>
      <div className="flex max-w-[60%] shrink-0 flex-col items-end gap-1">
        <Badge variant={status.variant}>{status.label}</Badge>
        {item.message && (
          <span
            className={cn(
              'text-right text-xs',
              item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {item.message}
          </span>
        )}
      </div>
    </div>
  );
};

const CountList = ({ summary }: { summary: BackupRestoreSummaryType }) => {
  // 成功 = 新增 + 更新；跳过 = 已存在（same）+ 显式跳过；失败单列
  const success = summary.new + (summary.updated ?? 0);
  const skipped = summary.same + summary.skipped;

  return (
    <div className="flex flex-wrap gap-2">
      <StatPill label="成功" value={success} tone="primary" />
      <StatPill label="跳过" value={skipped} tone="muted" />
      <StatPill label="失败" value={summary.failed} tone={summary.failed > 0 ? 'destructive' : 'muted'} />
    </div>
  );
};

const CredentialNotice = ({ text }: { text?: string }) => {
  if (!text) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>备份文件含 Token 凭据</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
};

const NoteAlert = ({ text }: { text: string }) => (
  <Alert>
    <Info />
    <AlertDescription>{text}</AlertDescription>
  </Alert>
);

export type RestoreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: BackupModuleType;
  /** 恢复成功后的回调（调用方可在此刷新列表 / 计数） */
  onRestored?: () => void;
};

export const RestoreDialog = observer(({ open, onOpenChange, module, onRestored }: RestoreDialogProps) => {
  const store = React.useContext(StoreContext);
  const meta = MODULE_META[module];

  const [phase, setPhase] = React.useState<RestorePhaseType>('pick');
  const [mode, setMode] = React.useState<BackupRestoreModeType>('merge');
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<BackupRestoreResultType | null>(null);
  const [result, setResult] = React.useState<BackupRestoreResultType | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  /** 变更 key 让文件输入框重新挂载：重新选文件时清掉 DOM 里的旧文件名 */
  const [pickerKey, setPickerKey] = React.useState(0);

  /**
   * 会话号：每次打开 / 切换板块 / 重新选文件都自增。
   * 异步预检 / 恢复在 await 后比对会话号，丢弃已过期的结果，避免关闭弹窗后
   * 迟到的响应把状态改回 preview / result。
   */
  const sessionRef = React.useRef(0);

  React.useEffect(() => {
    sessionRef.current += 1;
    setPhase('pick');
    setMode('merge');
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(false);
    setConfirming(false);
    setPickerKey((value) => value + 1);
  }, [open, module]);

  /** 执行完恢复后刷新对应模块的数据，让设置页条数与列表保持一致（不新增 store 方法） */
  const refreshRestoredData = () => {
    if (module === 'bookmarks') {
      void store.fetchItems();
      void store.fetchTags('bookmarks');
      return;
    }

    if (module === 'skills') {
      void store.fetchSkills();
      return;
    }

    void store.fetchServers(store.serverListParams);
  };

  const runPreview = async (targetFile: File, targetMode: BackupRestoreModeType) => {
    const session = sessionRef.current;
    setBusy(true);
    setError(null);

    try {
      const data = await store.previewRestore(module, targetFile, targetMode);
      if (session !== sessionRef.current) {
        return;
      }

      if (!data) {
        setError('预检失败，请确认备份文件完整且来自本应用后重试');
        setPhase('pick');
        return;
      }

      setPreview(data);
      setPhase('preview');
    } finally {
      if (session === sessionRef.current) {
        setBusy(false);
      }
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    const session = sessionRef.current;
    // 清空 DOM 值，允许重复选择同一个文件触发 change
    event.target.value = '';

    if (!selected) {
      return;
    }

    setError(null);

    if (!selected.name.toLowerCase().endsWith('.json')) {
      setError('请选择 .json 备份文件（账号库请在账号库分区使用 .slvault 导入）');
      return;
    }

    if (selected.size === 0) {
      setError('备份文件为空，请重新选择');
      return;
    }

    if (selected.size > MAX_BACKUP_SIZE) {
      setError(`备份文件超过 32 MB（当前 ${formatServerBytes(selected.size)}），请选择更小的文件`);
      return;
    }

    // 本地先解析并核对 module：格式问题在预检前就给出明确中文提示，不占用上传
    let payload: unknown;
    try {
      payload = JSON.parse(await selected.text());
    } catch {
      setError('无法解析备份文件，请确认选择的是本应用导出的 JSON 文件');
      return;
    }

    // 读取文件期间弹窗可能已关闭 / 切换板块，过期选择直接丢弃
    if (session !== sessionRef.current) {
      return;
    }

    if (!payload || typeof payload !== 'object' || (payload as { module?: unknown }).module !== module) {
      setError('备份文件与当前板块不匹配，请选择对应的备份文件');
      return;
    }

    setFile(selected);
    await runPreview(selected, mode);
  };

  const handleModeChange = (nextMode: BackupRestoreModeType) => {
    if (busy || nextMode === mode) {
      return;
    }

    setMode(nextMode);
    // 分类结果随模式变化（覆盖会重建 / 删除），必须用新模式重新预检
    if (file && phase === 'preview') {
      void runPreview(file, nextMode);
    }
  };

  const handleRestore = async () => {
    if (!file || busy) {
      return;
    }

    const session = sessionRef.current;
    setBusy(true);
    setError(null);

    try {
      const data = await store.restoreBackup(module, file, mode);
      if (session !== sessionRef.current) {
        return;
      }

      if (!data) {
        // 失败原因已由统一请求层 toast（后端 message），留在预检态可重试
        setError('恢复失败，请查看提示后重试');
        return;
      }

      setResult(data);
      setPhase('result');
      refreshRestoredData();
      onRestored?.();
    } finally {
      if (session === sessionRef.current) {
        setBusy(false);
      }
    }
  };

  const handleStart = () => {
    if (busy || !file) {
      return;
    }

    if (mode === 'overwrite') {
      setConfirming(true);
      return;
    }

    void handleRestore();
  };

  const resetToPick = () => {
    // 自增会话号：丢弃可能仍在途的预检结果
    sessionRef.current += 1;
    setPhase('pick');
    setMode('merge');
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(false);
    setConfirming(false);
    setPickerKey((value) => value + 1);
  };

  /** 预检 / 恢复进行中不允许关闭：避免弹窗关掉后请求仍写库，与「关闭即放弃」的语义冲突 */
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && busy) {
      return;
    }

    onOpenChange(nextOpen);
  };

  const modeOptions: Array<{ value: BackupRestoreModeType; label: string; hint: string }> = [
    { value: 'merge', label: '合并（默认）', hint: meta.mergeHint },
    { value: 'overwrite', label: '覆盖', hint: meta.overwriteHint },
  ];

  const detailParts = result
    ? [
        `新增 ${result.summary.new}`,
        ...(result.summary.updated !== undefined ? [`更新 ${result.summary.updated}`] : []),
        `已存在 ${result.summary.same}`,
        `跳过 ${result.summary.skipped}`,
      ]
    : [];

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="text-base">恢复{meta.title}</DialogTitle>
            <DialogDescription>
              {phase === 'result'
                ? '恢复已执行，可查看逐条结果；关闭弹窗不会撤销已写入的数据。'
                : '恢复前会先预检分类，确认后才写库；关闭弹窗即放弃本次恢复。'}
            </DialogDescription>
          </DialogHeader>

          {phase === 'pick' && (
            <>
              <div className="flex flex-col gap-4">
                <CredentialNotice text={meta.credentialNotice} />

                <div className="flex flex-col gap-2">
                  <Label htmlFor="restore-backup-file">备份文件</Label>
                  <Input
                    key={pickerKey}
                    id="restore-backup-file"
                    type="file"
                    accept=".json"
                    disabled={busy}
                    onChange={(event) => void handleFileChange(event)}
                  />
                  <p className="text-muted-foreground text-sm">{meta.pickHint}仅支持 .json，且不超过 32 MB。</p>
                </div>

                {busy && (
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Spinner />
                    正在预检备份文件…
                  </p>
                )}

                {error && (
                  <p className="text-destructive text-sm" role="alert">
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                  取消
                </Button>
              </DialogFooter>
            </>
          )}

          {phase === 'preview' && preview && (
            <>
              <div className="flex flex-col gap-4">
                <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <span className="min-w-0 truncate text-sm" title={file?.name}>
                    {file?.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {file ? formatServerBytes(file.size) : ''}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">预检结果</span>
                  <div className="flex flex-wrap gap-2">
                    <StatPill label="新增" value={preview.summary.new} tone="primary" />
                    {(preview.summary.updated ?? 0) > 0 && (
                      <StatPill label="更新" value={preview.summary.updated ?? 0} tone="primary" />
                    )}
                    <StatPill label="同名" value={preview.summary.same} />
                    <StatPill label="跳过" value={preview.summary.skipped} tone="muted" />
                    {preview.summary.failed > 0 && (
                      <StatPill label="失败" value={preview.summary.failed} tone="destructive" />
                    )}
                  </div>
                  {preview.tags && (
                    <p className="text-muted-foreground text-xs">
                      标签：新建 {preview.tags.new} 个，复用 {preview.tags.same} 个。
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">恢复模式</span>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="恢复模式">
                    {modeOptions.map((option) => {
                      const active = mode === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={busy}
                          onClick={() => handleModeChange(option.value)}
                          className={cn(
                            'rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
                            active ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {option.label}
                            {active && <Check className="text-primary ml-auto size-4" />}
                          </span>
                          <span className="text-muted-foreground mt-1 block text-xs">{option.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {module === 'servers' && <CredentialNotice text={meta.credentialNotice} />}

                {preview.note && <NoteAlert text={preview.note} />}

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">逐条预览（{preview.items.length} 条）</span>
                  {preview.items.length === 0 ? (
                    <p className="text-muted-foreground text-sm">备份文件中没有可恢复的条目。</p>
                  ) : (
                    <div className="no-scrollbar flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
                      {preview.items.map((item, index) => (
                        <RestoreItemRow key={`${item.name}-${index}`} item={item} />
                      ))}
                    </div>
                  )}
                </div>

                {busy && (
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Spinner />
                    正在按新模式重新预检…
                  </p>
                )}

                {error && (
                  <p className="text-destructive text-sm" role="alert">
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={resetToPick} disabled={busy}>
                  重新选文件
                </Button>
                <Button
                  variant={mode === 'overwrite' ? 'destructive' : 'default'}
                  onClick={handleStart}
                  disabled={busy || preview.items.length === 0}
                >
                  {busy && <Spinner />}
                  开始恢复
                </Button>
              </DialogFooter>
            </>
          )}

          {phase === 'result' && result && (
            <>
              <div className="flex flex-col gap-4">
                <CountList summary={result.summary} />

                <p className="text-muted-foreground text-xs">{detailParts.join(' · ')}</p>

                {(result.removed ?? 0) > 0 && (
                  <p className="text-muted-foreground text-xs">已清理备份之外的服务器 {result.removed} 台。</p>
                )}

                {result.note && <NoteAlert text={result.note} />}

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">逐条结果（{result.items.length} 条）</span>
                  {result.items.length === 0 ? (
                    <p className="text-muted-foreground text-sm">备份文件中没有可恢复的条目。</p>
                  ) : (
                    <div className="no-scrollbar flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                      {result.items.map((item, index) => (
                        <RestoreItemRow key={`${item.name}-${index}`} item={item} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={resetToPick}>
                  恢复其他文件
                </Button>
                <Button onClick={() => onOpenChange(false)}>完成</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 覆盖模式的二次确认：嵌套 AlertDialog 独立成层，文案必须写清不可逆后果 */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>用备份覆盖现有{meta.title}？</AlertDialogTitle>
            <AlertDialogDescription>{meta.confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 text-white shadow-xs"
              disabled={busy}
              onClick={(event) => {
                // 拦截默认关闭：恢复失败时要留在预检态显示错误
                event.preventDefault();
                setConfirming(false);
                void handleRestore();
              }}
            >
              {busy && <Spinner />}
              覆盖并恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
