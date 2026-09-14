'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import {
  authDialogActionStackClassName,
  authDialogFieldStackClassName,
  authDialogFormClassName,
  authDialogSectionClassName,
  authInputClassName,
  authPrimaryButtonClassName,
  Field,
} from '@/features/auth/auth-field';
import { AuthIntro, AuthPanel } from '@/features/auth/auth-layout';
import { AuthSocialLoginSection } from '@/features/auth/auth-social-login';
import { authClient, resolveMailCooldownErrorMessage } from '@/lib/auth';
import { looksLikeEmail } from '@/lib/auth/api';
import { isEmailNotVerifiedError } from '@/lib/auth/auth-errors';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';
import { signInSchema } from '@/lib/validations';

function isEmailVerificationRequired(error: { status?: number; code?: string | number } | null): boolean {
  if (!error) {
    return false;
  }
  return isEmailNotVerifiedError(error.code);
}

type SignInFormProps = {
  embedded?: boolean;
  onSuccess?: () => void | Promise<void>;
  onSwitchMode?: (mode: 'register' | 'forgot-password') => void;
};

export function SignInForm({ embedded = false, onSuccess, onSwitchMode }: SignInFormProps) {
  const { locale } = useLocale();
  const [formError, setFormError] = useState<string | null>(null);
  const [isVerificationRequired, setIsVerificationRequired] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const form = useForm({
    defaultValues: {
      login: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      setIsVerificationRequired(false);
      const parsed = signInSchema.safeParse(value);
      if (!parsed.success) {
        setFormError(t(locale, 'auth.errors.invalidInput'));
        return;
      }

      const { error } = await authClient.login(parsed.data);

      if (error) {
        if (isEmailVerificationRequired(error)) {
          setIsVerificationRequired(true);
          setFormError(t(locale, 'auth.signIn.verificationRequired'));
          return;
        }
        const message = error.message || t(locale, 'auth.errors.signInFailed');
        setFormError(message);
        toast.error(message);
        return;
      }

      toast.success(t(locale, 'auth.signIn.success'));
      await onSuccess?.();
    },
  });

  async function handleResendVerification() {
    const login = form.state.values.login.trim();
    if (!login || isResending) {
      return;
    }

    if (!looksLikeEmail(login)) {
      const message = t(locale, 'auth.signIn.resendVerificationEmailHint');
      setFormError(message);
      toast.error(message);
      return;
    }

    setIsResending(true);
    const { error } = await authClient.resendVerificationEmail(login);
    setIsResending(false);

    if (error) {
      const cooldownMessage = resolveMailCooldownErrorMessage(error);
      const message = cooldownMessage || error.message || t(locale, 'auth.errors.sendFailed');
      setFormError(message);
      toast.error(message);
      return;
    }

    toast.success(t(locale, 'auth.signIn.resendVerificationSuccess'));
  }

  const forgotPasswordLink = (
    <button
      type="button"
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      onClick={() => onSwitchMode?.('forgot-password')}
    >
      {t(locale, 'auth.signIn.forgotPassword')}
    </button>
  );

  return (
    <>
      {!embedded ? <AuthIntro title={t(locale, 'auth.signIn.title')} /> : null}

      <AuthPanel variant={embedded ? 'plain' : 'card'}>
        <div className={cn(embedded && authDialogSectionClassName)}>
          <form
            className={cn(embedded ? authDialogFormClassName : 'space-y-4')}
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <div className={embedded ? authDialogFieldStackClassName : 'contents'}>
              <form.Field name="login">
                {(field) => (
                  <Field hideLabel={embedded} label={t(locale, 'auth.signIn.loginLabel')} htmlFor="sign-in-login">
                    <input
                      id="sign-in-login"
                      type="text"
                      autoComplete="username"
                      placeholder={
                        embedded
                          ? t(locale, 'auth.signIn.loginPlaceholderEmbedded')
                          : t(locale, 'auth.signIn.loginPlaceholder')
                      }
                      className={authInputClassName}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="password">
                {(field) => (
                  <Field
                    hideLabel={embedded}
                    label={t(locale, 'auth.signIn.passwordLabel')}
                    htmlFor="sign-in-password"
                    labelAside={embedded ? undefined : forgotPasswordLink}
                  >
                    <input
                      id="sign-in-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder={
                        embedded
                          ? t(locale, 'auth.signIn.passwordPlaceholderEmbedded')
                          : t(locale, 'auth.signIn.passwordPlaceholder')
                      }
                      className={authInputClassName}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
            </div>

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            {isVerificationRequired ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full rounded-md"
                disabled={isResending}
                onClick={() => {
                  void handleResendVerification();
                }}
              >
                {isResending
                  ? t(locale, 'auth.signIn.resendVerificationSending')
                  : t(locale, 'auth.signIn.resendVerification')}
              </Button>
            ) : null}

            <div className={embedded ? authDialogActionStackClassName : 'contents'}>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button type="submit" className={authPrimaryButtonClassName} disabled={isSubmitting}>
                    {isSubmitting ? t(locale, 'auth.signIn.submitting') : t(locale, 'auth.signIn.submit')}
                  </Button>
                )}
              </form.Subscribe>

              {embedded ? forgotPasswordLink : null}
            </div>
          </form>
          {embedded ? <AuthSocialLoginSection /> : null}
        </div>
      </AuthPanel>
    </>
  );
}
