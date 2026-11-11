import { ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils.ts';

/**
 * 非安全上下文警示（PRD O-7）。
 *
 * 账号库的加解密依赖 `crypto.subtle`、复制依赖 `navigator.clipboard`，
 * 二者只在安全上下文（HTTPS 或 localhost）可用。HTTP 部署时若无提示，
 * 用户登录后才会在账号库里撞上加解密 / 复制静默失效。
 *
 * 判定统一走 `window.isSecureContext`：它覆盖 localhost 等本应视为安全的场景，
 * 自行拼接 `location.protocol` 容易误判。安全上下文下本组件渲染 null。
 */
export const SecureContextWarning = ({ className }: { className?: string }) => {
  if (window.isSecureContext) {
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
      <span>当前为 HTTP 访问，账号库加密与复制不可用，请使用 HTTPS。</span>
    </div>
  );
};
