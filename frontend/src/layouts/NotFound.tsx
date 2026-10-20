import React from 'react';

export const NotFound = ({ children }: { children?: React.ReactNode }) => (
  <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
    <div className="w-full max-w-sm">
      {children || (
        <>
          <h1>404 - 页面不存在</h1>
          <p>您访问的页面不存在。</p>
        </>
      )}
    </div>
  </div>
);
