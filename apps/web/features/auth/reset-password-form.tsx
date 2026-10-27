'use client';

import { useForm } from '@tanstack/react-form';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { useAuthDialog } from '@/features/auth/auth-dialog-provider';
import { authInputClassName, authPrimaryButtonClassName, Field } from '@/features/auth/auth-field';
import { AuthFooterLink, AuthIntro, AuthPanel } from '@/features/auth/auth-layout';
import { authClient, resolveAuthErrorMessage } from '@/lib/auth';
import { isInvalidLinkError } from '@/lib/auth/auth-errors';
import { consumePostAuthPath } from '@/lib/auth/post-auth-redirect';
import { useLocale } from '@/lib/locale-context';
import { resetPasswordSchema } from '@/lib/validations';

export function ResetPasswordForm() {
  const { locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openForgotPassword } = useAuthDialog();
  const token = searchParams.get('token');
  const tokenError = searchParams.get('error');
  // Missing token, Better Auth `error=INVALID_TOKEN` redirect, or an expired
  // token rejected at submit time all land in the recovery state below.
  const [isLinkInvalid, setLinkInvalid] = useState(() => !token || tokenError === 'INVALID_TOKEN');
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      password: '',
      passwordConfirm: '',
    },
    onSubmit: async ({ value }) => {
      if (!token) {
        setLinkInvalid(true);
        return;
      }

      setFormError(null);
      const parsed = resetPasswordSchema.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message =
          issue?.path.includes('passwordConfirm') && issue.code === 'custom'
            ? t(locale, 'auth.errors.passwordMismatch')
            : t(locale, 'auth.errors.invalidInput');
        setFormError(message);
        return;
      }

      const { error } = await authClient.resetPassword({
        password: parsed.data.password,
        token,
      });

      if (error) {
        const message = resolveAuthErrorMessage(error, locale, 'auth.resetPassword.failed');
        if (isInvalidLinkError(error)) {
          // Expired or already-used link: switch to the recovery state so the
          // existing forgot-password flow can issue a fresh reset email.
          setLinkInvalid(true);
          toast.error(message);
          return;
        }
        setFormError(message);
        toast.error(message);
        return;
      }

      toast.success(t(locale, 'auth.resetPassword.success'));
      router.replace(consumePostAuthPath(searchParams));
    },
  });

  if (isLinkInvalid) {
    return (
      <>
        <AuthIntro
          title={t(locale, 'auth.resetPassword.title')}
          description={t(locale, 'auth.resetPassword.invalidToken')}
        />

        <AuthPanel>
          <Button type="button" className={authPrimaryButtonClassName} onClick={openForgotPassword}>
            {t(locale, 'auth.resetPassword.requestNewLink')}
          </Button>
        </AuthPanel>

        <AuthFooterLink href="/" label={t(locale, 'auth.resetPassword.backToProduct')} />
      </>
    );
  }

  return (
    <>
      <AuthIntro title={t(locale, 'auth.resetPassword.title')} />

      <AuthPanel>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="password">
            {(field) => (
              <Field label={t(locale, 'auth.resetPassword.passwordLabel')} htmlFor="reset-password">
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder={t(locale, 'auth.resetPassword.passwordPlaceholder')}
                  className={authInputClassName}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="passwordConfirm">
            {(field) => (
              <Field label={t(locale, 'auth.resetPassword.confirmLabel')} htmlFor="reset-password-confirm">
                <input
                  id="reset-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={authInputClassName}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" className={authPrimaryButtonClassName} disabled={isSubmitting}>
                {isSubmitting ? t(locale, 'auth.resetPassword.submitting') : t(locale, 'auth.resetPassword.submit')}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </AuthPanel>

      <AuthFooterLink href="/" label={t(locale, 'auth.resetPassword.backToProduct')} />
    </>
  );
}
