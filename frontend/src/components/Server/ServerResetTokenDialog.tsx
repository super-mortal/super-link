import { useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
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
import { ServerTokenGuide } from '@/components/Server/ServerTokenGuide.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import type { ServerTokenResponseType, ServerWithStatusType } from '@/lib/types.ts';

/**
 * 重置 Agent Token 弹窗（PRD §5.1「Token 重置」、D6）。
 *
 * 两步同窗完成：二次确认（说明旧 Token 立即失效）→ 调用 resetServerToken → 展示新 Token
 * 明文与完整安装命令（与添加弹窗成功态共用 ServerTokenGuide，不复制第二份展示）。
 *
 * 新 Token 明文同样只在这一个内存态里出现一次：关闭弹窗即清理，不落任何持久化存储。
 */

type ServerResetTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: ServerWithStatusType | null;
  /** 重置成功后的回调（详情页重拉：updated_at 等字段变化） */
  onCompleted?: () => void;
};

export const ServerResetTokenDialog = observer(
  ({ open, onOpenChange, server, onCompleted }: ServerResetTokenDialogProps) => {
    const store = useContext(StoreContext);
    /** confirm = 二次确认；guide = 新 Token 与安装命令指引 */
    const [step, setStep] = useState<'confirm' | 'guide'>('confirm');
    const [result, setResult] = useState<ServerTokenResponseType | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // 关闭即回到确认态并清理新 Token：下次打开是一次全新的二次确认
    useEffect(() => {
      if (!open) {
        setStep('confirm');
        setResult(null);
      }
    }, [open]);

    const handleReset = async () => {
      if (!server || submitting) {
        return;
      }
      setSubmitting(true);

      try {
        const response = await store.resetServerToken(server.id);
        // 失败时留在确认态：store 已按后端 message toast，可直接重试
        if (!response) {
          return;
        }
        setResult(response);
        setStep('guide');
        onCompleted?.();
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px]">
          {step === 'guide' && result && server ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">重置「{server.name}」的 Token</DialogTitle>
                <DialogDescription>旧 Token 已立即失效，请在被监控机器上重新执行下面的命令。</DialogDescription>
              </DialogHeader>

              <ServerTokenGuide token={result.token} installCommand={result.install_command} />

              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>完成</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">重置「{server?.name ?? ''}」的 Agent Token？</DialogTitle>
                <DialogDescription>旧 Token 将立即失效，需要重新配置被监控机器上的 Agent。</DialogDescription>
              </DialogHeader>

              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                  取消
                </Button>
                <Button variant="destructive" onClick={() => void handleReset()} disabled={submitting}>
                  {submitting && <Spinner />}
                  重置 Token
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }
);
