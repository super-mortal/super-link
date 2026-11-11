import type { ReactNode } from 'react';

/**
 * 认证页布局外壳（PRD O-6）。
 *
 * ≥1024px 两栏：左侧 `intro` 放项目介绍，右侧 `children` 放登录卡片；
 * <1024px 单列：`intro` 在上、`children` 在下（介绍内容内部的显隐由 intro 自行控制）。
 */
export const Auth = ({ intro, children }: { intro?: ReactNode; children: ReactNode }) => {
  return (
    <div className="bg-muted flex min-h-svh items-center justify-center p-3 md:p-10">
      <div className="flex w-full max-w-5xl flex-col items-center gap-8 lg:flex-row lg:justify-center lg:gap-16">
        {intro}
        <div className="w-full max-w-sm min-w-xs">{children}</div>
      </div>
    </div>
  );
};
