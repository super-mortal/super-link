import { ShieldAlert } from 'lucide-react';

import { isVaultCryptoAvailable } from '@/lib/vaultCrypto.ts';
import { cn } from '@/lib/utils.ts';

/** 默认文案：登录页 / 锁定页的通用提示；设置主密码入口用 `message` 覆盖为更具体的阻塞说明 */
const DEFAULT_MESSAGE = '当前为 HTTP 访问，账号库加密与复制不可用，请使用 HTTPS。';

/**
 * 非安全上下文警示（PRD O-7 / refinements-v0.1.2 §4.3）。
 *
 * 账号库的加解密依赖 `crypto.subtle`、复制依赖 `navigator.clipboard`，
 * 二者只在安全上下文（HTTPS 或 localhost）可用。HTTP 部署时若无提示，
 * 用户登录后才会在账号库里撞上加解密 / 复制静默失效。
 *
 * 判定统一走 `isVaultCryptoAvailable()`（`window.isSecureContext` + `crypto.subtle`），
 * 自行拼接 `location.protocol` 容易误判。安全上下文下本组件渲染 null。
 * `message` 供设置主密码表单覆盖为「无法设置主密码」的具体说明。
 */
export const SecureContextWarning = ({
  className,
  message = DEFAULT_MESSAGE,
}: {
  className?: string;
  message?: string;
}) => {
  if (isVaultCryptoAvailable()) {
    return null;
  }

  return (
    <div
      role="alert"
      className={cn(
        'border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-relaxed',
        className
      )}
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
};
