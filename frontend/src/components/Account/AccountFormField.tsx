import type { ReactNode } from 'react';

/**
 * 账号库弹窗表单的字段外壳：标签 + 必填星号 + 错误 / 提示位。
 * 账号弹窗与授权弹窗（AuthorizationFormDialog）共用，避免两个弹窗各复制一份。
 * className 供跨列字段（如备注、登录地址）使用。
 */
export const AccountFormField = ({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  /** 就地显示在校验下方的中文错误（PRD §8.3：本地校验错误不弹统一提示） */
  error?: string | null;
  hint?: string;
  className?: string;
  children: ReactNode;
}) => (
  <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
    <label htmlFor={htmlFor} className="text-[13px] font-medium">
      {label}
      {required && <span className="text-destructive"> *</span>}
    </label>
    {children}
    {error ? <p className="text-destructive text-xs">{error}</p> : null}
    {!error && hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
  </div>
);
