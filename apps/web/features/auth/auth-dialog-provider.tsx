'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { AuthDialog, type AuthMode, type AuthReason } from '@/features/auth/auth-dialog';
import { authClient } from '@/lib/auth';
import { consumePostAuthPath, rememberAuthReturnPath } from '@/lib/auth/post-auth-redirect';

type AuthDialogOptions = {
  reason?: AuthReason;
};

type AuthDialogController = {
  openLogin: (options?: AuthDialogOptions) => void;
  openRegister: (options?: AuthDialogOptions) => void;
  openForgotPassword: () => void;
  close: () => void;
  switchMode: (mode: AuthMode) => void;
};

const AuthDialogContext = createContext<AuthDialogController | null>(null);

export function AuthDialogProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [reason, setReason] = useState<AuthReason>();
  const { refresh } = authClient.useSession();

  const close = useCallback(() => {
    setIsOpen(false);
    setReason(undefined);
  }, []);

  const openWithMode = useCallback((nextMode: AuthMode, options?: AuthDialogOptions) => {
    rememberAuthReturnPath();
    setMode(nextMode);
    setReason(options?.reason);
    setIsOpen(true);
  }, []);

  const controller = useMemo<AuthDialogController>(
    () => ({
      openLogin: (options) => openWithMode('login', options),
      openRegister: (options) => openWithMode('register', options),
      openForgotPassword: () => openWithMode('forgot-password'),
      close,
      switchMode: setMode,
    }),
    [close, openWithMode],
  );

  async function handleAuthSuccess() {
    await refresh();
    close();
    router.replace(consumePostAuthPath(searchParams));
  }

  return (
    <AuthDialogContext.Provider value={controller}>
      {children}
      <AuthDialog
        open={isOpen}
        mode={mode}
        reason={reason}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close();
        }}
        onSuccess={handleAuthSuccess}
        onSwitchMode={setMode}
      />
    </AuthDialogContext.Provider>
  );
}

export function useAuthDialog() {
  const context = useContext(AuthDialogContext);
  if (!context) {
    throw new Error('useAuthDialog must be used within AuthDialogProvider');
  }
  return context;
}

export function useRequireAuth() {
  const dialog = useAuthDialog();
  const { data, isPending } = authClient.useSession();

  return useCallback(
    (options?: AuthDialogOptions) => {
      if (isPending) {
        return false;
      }
      if (!isPending && data?.user) {
        return true;
      }
      dialog.openLogin(options);
      return false;
    },
    [data?.user, dialog, isPending],
  );
}
