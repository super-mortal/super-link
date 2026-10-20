import React from 'react';
import { Logo } from '@/components/Logo.tsx';

export const Auth = ({ children }) => {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-8 p-3 md:p-10">
      <Logo />
      {children}
    </div>
  );
};
