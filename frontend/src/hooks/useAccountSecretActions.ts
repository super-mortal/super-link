import { useCallback } from 'react';
import { toast } from 'sonner';
import { copySecret } from '@/lib/copySecret.ts';
import { useCopyPasswordGuard } from '@/hooks/useCopyPasswordGuard.tsx';

/**
 * 账号列表里「显示 / 复制」的占位回调（PRD §9.4）。
 *
 * 账号标识是明文元数据，现在就可以复制；密码明文要按需拉详情解密并做 60 秒
 * 内存缓存，解密链路在 task10 接入，本任务只把回调位接好：点击显示 / 复制
 * 密码时给明确占位提示，不渲染任何假明文。
 * 账号列表只在解锁态渲染（PRD §10.1），所以这里不需要处理锁定态分支。
 *
 * 复制密码的二次确认（PRD §7.3）在这里一并接上：真实解密链路接入后，
 * 只需把 guardCopyPassword 里的占位 toast 换成「解密 -> copySecret」即可。
 */
export const useAccountSecretActions = () => {
  const { guard: guardCopyPassword, confirmDialog: copyPasswordConfirmDialog } = useCopyPasswordGuard();

  const copyIdentifier = useCallback((identifier: string) => copySecret(identifier), []);
  const revealPassword = useCallback(() => {
    toast('密码解密将在后续任务接入', { position: 'top-center' });
  }, []);
  const copyPassword = useCallback(() => {
    guardCopyPassword(() => {
      toast('密码复制将在后续任务接入', { position: 'top-center' });
    });
  }, [guardCopyPassword]);

  return { copyIdentifier, revealPassword, copyPassword, copyPasswordConfirmDialog };
};
