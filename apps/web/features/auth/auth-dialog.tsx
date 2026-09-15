'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';
import { SignInForm } from '@/features/auth/sign-in-form';
import { SignUpForm } from '@/features/auth/sign-up-form';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export type AuthMode = 'login' | 'register' | 'forgot-password';
export type AuthReason = 'save' | 'bookmark' | 'sync' | 'ai' | 'bilingual' | 'history';

type AuthDialogProps = {
  open: boolean;
  mode: AuthMode;
  reason?: AuthReason;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void | Promise<void>;
  onSwitchMode: (mode: AuthMode) => void;
};

const REASON_KEYS: Record<AuthReason, string> = {
  save: 'auth.dialog.reasonSave',
  bookmark: 'auth.dialog.reasonBookmark',
  sync: 'auth.dialog.reasonSync',
  ai: 'auth.dialog.reasonAi',
  bilingual: 'auth.dialog.reasonBilingual',
  history: 'auth.dialog.reasonHistory',
};

export function AuthDialog({ open, mode, reason, onOpenChange, onSuccess, onSwitchMode }: AuthDialogProps) {
  const { locale } = useLocale();

  const title =
    mode === 'login'
      ? t(locale, 'auth.signIn.title')
      : mode === 'register'
        ? t(locale, 'auth.signUp.title')
        : t(locale, 'auth.forgotPassword.title');
  const isLoginFlow = mode === 'login' || mode === 'forgot-password';
  const shouldShowTabs = mode !== 'forgot-password';
  const reasonCopy = reason ? t(locale, REASON_KEYS[reason]) : title;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px] transition-opacity duration-200',
            'data-ending-style:opacity-0 data-starting-style:opacity-0',
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[min(44rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)]',
            '-translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-card text-foreground',
            'shadow-card ring-1 ring-border/40 outline-none sm:max-w-[26rem]',
            'motion-safe:data-starting-style:animate-in motion-safe:data-starting-style:fade-in-0',
            'motion-safe:data-starting-style:zoom-in-95 motion-safe:data-ending-style:animate-out',
            'motion-safe:data-ending-style:fade-out-0 motion-safe:data-ending-style:zoom-out-95',
          )}
        >
          <DialogPrimitive.Close
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-3.5 right-3.5 z-10 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              />
            }
          >
            <XIcon aria-hidden />
            <span className="sr-only">{t(locale, 'auth.dialog.closeAria')}</span>
          </DialogPrimitive.Close>

          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{reasonCopy}</DialogPrimitive.Description>

          <div className="px-6 pt-12 pb-7">
            {shouldShowTabs ? (
              <div
                className="grid grid-cols-2 border-b border-border/50"
                role="tablist"
                aria-label={t(locale, 'auth.dialog.tablistAria')}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isLoginFlow}
                  className={cn(
                    'relative pb-3 text-base font-medium transition-colors',
                    'after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-[2px] after:bg-primary after:transition-transform',
                    isLoginFlow
                      ? 'text-primary after:scale-x-100'
                      : 'text-muted-foreground after:scale-x-0 hover:text-foreground',
                  )}
                  onClick={() => onSwitchMode('login')}
                >
                  {t(locale, 'auth.dialog.signInTab')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  className={cn(
                    'relative pb-3 text-base font-medium transition-colors',
                    'after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-[2px] after:bg-primary after:transition-transform',
                    mode === 'register'
                      ? 'text-primary after:scale-x-100'
                      : 'text-muted-foreground after:scale-x-0 hover:text-foreground',
                  )}
                  onClick={() => onSwitchMode('register')}
                >
                  {t(locale, 'auth.dialog.signUpTab')}
                </button>
              </div>
            ) : null}

            <div className={cn(shouldShowTabs ? 'pt-6' : 'pt-1')}>
              {!shouldShowTabs ? (
                <h2 className="mb-5 text-center text-base font-semibold tracking-tight text-foreground">
                  {t(locale, 'auth.dialog.forgotPasswordTitle')}
                </h2>
              ) : null}
              {reason ? <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{reasonCopy}</p> : null}
              {mode === 'login' ? (
                <SignInForm embedded onSuccess={onSuccess} onSwitchMode={onSwitchMode} />
              ) : mode === 'register' ? (
                <SignUpForm embedded />
              ) : (
                <ForgotPasswordForm embedded onSwitchMode={onSwitchMode} />
              )}
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
