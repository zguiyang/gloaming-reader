'use client';

import { ThemeProvider, useTheme } from 'next-themes';
import { type ReactNode, useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';

import type { Locale } from '@gloaming/i18n';

import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthDialogProvider } from '@/features/auth';
import { LocaleProvider } from '@/lib/locale-context';
import { QueryProvider } from '@/lib/query';

type ProvidersProps = {
  children: ReactNode;
  locale: Locale;
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

export function Providers({ children, locale }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <LocaleProvider locale={locale}>
        <QueryProvider>
          <TooltipProvider delay={300}>
            <AuthDialogProvider>
              {children}
              <ThemedToaster />
            </AuthDialogProvider>
          </TooltipProvider>
        </QueryProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
