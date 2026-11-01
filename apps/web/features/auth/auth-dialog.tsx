'use client';

import { XIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[min(44rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)]',
          '-translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-card text-foreground',
          'shadow-card ring-1 ring-border/40 outline-none sm:max-w-[26rem]',
        )}
      >
        <DialogClose
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
        </DialogClose>

        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{reasonCopy}</DialogDescription>

        <div className="px-6 pt-12 pb-7">
          {shouldShowTabs ? (
            <Tabs
              value={mode}
              className="gap-0"
              onValueChange={(value) => {
                if (value === 'login' || value === 'register') onSwitchMode(value);
              }}
            >
              <TabsList
                variant="line"
                className="grid h-auto w-full grid-cols-2 rounded-none border-b border-border/50 p-0"
                aria-label={t(locale, 'auth.dialog.tablistAria')}
              >
                <TabsTrigger
                  value="login"
                  className={cn(
                    'relative pb-3 text-base font-medium transition-colors',
                    'after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-[2px] after:bg-primary after:transition-transform',
                    isLoginFlow
                      ? 'text-primary after:scale-x-100'
                      : 'text-muted-foreground after:scale-x-0 hover:text-foreground',
                  )}
                >
                  {t(locale, 'auth.dialog.signInTab')}
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  className={cn(
                    'relative pb-3 text-base font-medium transition-colors',
                    'after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-[2px] after:bg-primary after:transition-transform',
                    mode === 'register'
                      ? 'text-primary after:scale-x-100'
                      : 'text-muted-foreground after:scale-x-0 hover:text-foreground',
                  )}
                >
                  {t(locale, 'auth.dialog.signUpTab')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value={mode} className="pt-6">
                {reason ? <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{reasonCopy}</p> : null}
                {mode === 'login' ? (
                  <SignInForm embedded onSuccess={onSuccess} onSwitchMode={onSwitchMode} />
                ) : (
                  <SignUpForm embedded />
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="pt-1">
              <h2 className="mb-5 text-center text-base font-semibold tracking-tight text-foreground">
                {t(locale, 'auth.dialog.forgotPasswordTitle')}
              </h2>
              {reason ? <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{reasonCopy}</p> : null}
              <ForgotPasswordForm embedded onSwitchMode={onSwitchMode} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
