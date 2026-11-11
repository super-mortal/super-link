import { useCallback, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { buildAad, decryptField } from '@/lib/vaultCrypto.ts';
import { cacheSecret, getDek, readCachedSecret } from '@/lib/vaultSession.ts';
import { copySecret } from '@/lib/copySecret.ts';
import { useCopyPasswordGuard } from '@/hooks/useCopyPasswordGuard.tsx';
import type { AccountSecretsType, TotpPayloadType, VaultSecretField, VaultSecretFieldName } from '@/lib/types.ts';

/**
 * 账号详情页的按需解密 hook（PRD §7.4 / §9.4 / §10.4）。
 *
 * 为什么按需解密：详情接口只返回密文，DEK 只在内存；一进详情就把所有字段解开，
 * 既慢又让明文在内存里无谓地长时间存活。密码更严格——默认掩码，点「显示」才解；
 * TOTP 与备注由调用方在挂载后加载（动态码打开就能抄、备注按 §10.4 直接展示）。
 *
 * 为什么缓存 60 秒：点一次「显示」、再点一次「复制」，中间不该重复跑 WebCrypto；
 * 缓存 TTL 由 vaultSession 统一管理（60 秒后过期），缩短明文在内存的暴露窗口。
 * 明文只进本 hook 的组件 state，**禁止**写入 localStorage / MobX observable / 日志。
 *
 * 解密失败统一文案不区分「密文损坏 / 版本不匹配 / AAD 不匹配」，不暴露 GCM 细节。
 */

/** 解密失败统一文案：与 vaultCrypto.decryptField 抛出的一致（PRD §10.6） */
const DECRYPT_FAILED_HINT = '无法解密该字段，请检查备份或重新保存';

/** 缓存 key 与 vaultSession 注释里的约定保持一致：account:{id}:{field} */
const secretCacheKey = (accountId: number, field: VaultSecretFieldName): string => `account:${accountId}:${field}`;

type SecretDecryptResultType =
  | { status: 'ok'; value: string }
  /** 该字段没有密文（未填写，如第三方登录账号没有密码） */
  | { status: 'empty' }
  /** 会话已锁定（DEK 不在内存） */
  | { status: 'locked' }
  | { status: 'error'; message: string };

const decryptSecret = async (
  accountId: number,
  field: VaultSecretFieldName,
  cipher: VaultSecretField | null | undefined
): Promise<SecretDecryptResultType> => {
  if (!cipher?.ct || !cipher?.iv) {
    return { status: 'empty' };
  }

  const cacheKey = secretCacheKey(accountId, field);
  const cached = readCachedSecret(cacheKey);
  if (cached !== null) {
    return { status: 'ok', value: cached };
  }

  const dek = getDek();
  if (!dek) {
    return { status: 'locked' };
  }

  try {
    const plaintext = await decryptField(dek, cipher.ct, cipher.iv, buildAad(accountId, field));
    cacheSecret(cacheKey, plaintext);
    return { status: 'ok', value: plaintext };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : DECRYPT_FAILED_HINT };
  }
};

export type AccountSecretActionsType = {
  /** 密码明文，解密成功才非 null；只存组件 state */
  password: string | null;
  passwordVisible: boolean;
  passwordPending: boolean;
  passwordError: string | null;
  revealPassword: () => Promise<void>;
  hidePassword: () => void;
  /** 头部「复制密码」用：按需解密（命中缓存则不重复解）后写剪贴板 */
  copyPassword: () => Promise<void>;
  /** 复制密码二次确认弹窗（PRD §7.3）：由使用本 hook 的页面渲染一次即可 */
  copyPasswordConfirmDialog: ReactNode;
  totp: TotpPayloadType | null;
  totpPending: boolean;
  totpError: string | null;
  loadTotp: () => Promise<void>;
  notes: string | null;
  notesPending: boolean;
  notesError: string | null;
  loadNotes: () => Promise<void>;
};

/**
 * @param accountId 账号 id（AAD 绑定用；详情未加载时为 0，此时所有解密入口都不会被触发）
 * @param secrets 详情接口返回的密文集合（ct / iv，Base64）
 */
export const useAccountSecretDecrypt = (
  accountId: number,
  secrets: AccountSecretsType | undefined
): AccountSecretActionsType => {
  const [password, setPassword] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [totp, setTotp] = useState<TotpPayloadType | null>(null);
  const [totpPending, setTotpPending] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [notesPending, setNotesPending] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  // 复制密码二次确认（PRD §7.3）：守卫状态 + 待渲染的确认弹窗
  const { guard: guardCopyPassword, confirmDialog: copyPasswordConfirmDialog } = useCopyPasswordGuard();

  // 账号切换（如从「登录方式」跳转到另一个账号，详情页复用同一组件实例）时清空上一个
  // 账号的明文，避免残留他人密码。用 React 官方的「prop 变化时调整 state」写法：
  // 渲染期内 setState 会立即以新值重渲染，不产生中间 commit，也无 effect 级联渲染。
  const [loadedAccountId, setLoadedAccountId] = useState(accountId);
  if (loadedAccountId !== accountId) {
    setLoadedAccountId(accountId);
    setPassword(null);
    setPasswordVisible(false);
    setPasswordPending(false);
    setPasswordError(null);
    setTotp(null);
    setTotpPending(false);
    setTotpError(null);
    setNotes(null);
    setNotesPending(false);
    setNotesError(null);
  }

  const revealPassword = useCallback(async () => {
    setPasswordVisible(true);
    if (password !== null) {
      return;
    }

    setPasswordPending(true);
    setPasswordError(null);
    const result = await decryptSecret(accountId, 'password', secrets?.password);
    setPasswordPending(false);

    if (result.status === 'ok') {
      setPassword(result.value);
      return;
    }
    if (result.status === 'empty') {
      // 没有密码密文：不展示掩码切换（正常情况下该行不会渲染显示按钮，这里兜底）
      setPasswordVisible(false);
      return;
    }
    if (result.status === 'locked') {
      setPasswordVisible(false);
      toast('请先解锁账号库', { position: 'top-center' });
      return;
    }
    setPasswordError(result.message);
  }, [accountId, secrets, password]);

  const hidePassword = useCallback(() => {
    setPasswordVisible(false);
  }, []);

  const copyPassword = useCallback(async () => {
    // 复制密码统一走二次确认守卫：设置关闭时直接执行，行为与之前一致（PRD §7.3）
    guardCopyPassword(async () => {
      if (password !== null) {
        await copySecret(password);
        return;
      }

      setPasswordPending(true);
      const result = await decryptSecret(accountId, 'password', secrets?.password);
      setPasswordPending(false);

      if (result.status === 'ok') {
        setPassword(result.value);
        await copySecret(result.value);
        return;
      }
      if (result.status === 'locked') {
        toast('请先解锁账号库', { position: 'top-center' });
        return;
      }
      if (result.status === 'empty') {
        toast('该账号未设置密码', { position: 'top-center' });
        return;
      }
      toast.error(result.message, { position: 'top-center' });
    });
  }, [guardCopyPassword, accountId, secrets, password]);

  const loadTotp = useCallback(async () => {
    setTotpPending(true);
    setTotpError(null);
    const result = await decryptSecret(accountId, 'totp', secrets?.totp);
    setTotpPending(false);

    if (result.status === 'ok') {
      try {
        setTotp(JSON.parse(result.value) as TotpPayloadType);
      } catch {
        // 解密成功但载荷不是合法 JSON：同样按「无法解密」处理，不暴露解析细节
        setTotpError(DECRYPT_FAILED_HINT);
      }
      return;
    }
    if (result.status === 'empty' || result.status === 'locked') {
      // 没有 TOTP 密文 / 已锁定：不渲染该区块，由 2FA 徽章传达状态
      return;
    }
    setTotpError(result.message);
  }, [accountId, secrets]);

  const loadNotes = useCallback(async () => {
    setNotesPending(true);
    setNotesError(null);
    const result = await decryptSecret(accountId, 'notes', secrets?.notes);
    setNotesPending(false);

    if (result.status === 'ok') {
      setNotes(result.value);
      return;
    }
    if (result.status === 'empty') {
      setNotes('');
      return;
    }
    if (result.status === 'locked') {
      return;
    }
    setNotesError(result.message);
  }, [accountId, secrets]);

  return {
    password,
    passwordVisible,
    passwordPending,
    passwordError,
    revealPassword,
    hidePassword,
    copyPassword,
    copyPasswordConfirmDialog,
    totp,
    totpPending,
    totpError,
    loadTotp,
    notes,
    notesPending,
    notesError,
    loadNotes,
  };
};
