'use client';

import { ThemeProvider, useTheme } from 'next-themes';
import { type ReactNode, useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';

type ProvidersProps = {
  children: ReactNode;
};

function subscribeNoop() {
  return () => {};
}

function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  const isClient = useIsClient();
  const toastTheme = isClient && resolvedTheme === 'dark' ? 'dark' : 'light';

  return <Toaster theme={toastTheme} richColors closeButton position="top-right" />;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <ThemedToaster />
    </ThemeProvider>
  );
}
