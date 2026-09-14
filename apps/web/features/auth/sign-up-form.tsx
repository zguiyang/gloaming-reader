'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import {
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
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';
import { signUpSchema } from '@/lib/validations';

export function SignUpForm({ embedded = false }: { embedded?: boolean }) {
  const { locale } = useLocale();
  const [isSent, setIsSent] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  const form = useForm({
    defaultValues: {
      name: '',
      username: '',
      email: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const parsed = signUpSchema.safeParse(value);
      if (!parsed.success) {
        setFormError(t(locale, 'auth.errors.invalidInput'));
        return;
      }

      const { error } = await authClient.register({
        email: parsed.data.email,
        password: parsed.data.password,
        username: parsed.data.username,
        name: parsed.data.name,
      });

      if (error) {
        const message = error.message || t(locale, 'auth.errors.signUpFailed');
        setFormError(message);
        toast.error(message);
        return;
      }

      setSubmittedEmail(parsed.data.email);
      setIsSent(true);
    },
  });

  async function handleResend() {
    if (!submittedEmail || isResending) {
      return;
    }

    setFormError(null);
    setIsResending(true);
    const { error } = await authClient.resendVerificationEmail(submittedEmail);
    setIsResending(false);

    if (error) {
      const cooldownMessage = resolveMailCooldownErrorMessage(error);
      const message = cooldownMessage || error.message || t(locale, 'auth.errors.sendFailed');
      setFormError(message);
      toast.error(message);
      return;
    }

    toast.success(t(locale, 'auth.signUp.resendSuccess'));
  }

  if (isSent) {
    return (
      <>
        {!embedded ? (
          <AuthIntro
            title={t(locale, 'auth.signUp.sentTitle')}
            description={t(locale, 'auth.signUp.sentDescription', { email: submittedEmail })}
          />
        ) : null}

        <AuthPanel variant={embedded ? 'plain' : 'card'}>
          {formError ? <p className="mb-4 text-sm text-destructive">{formError}</p> : null}
          <Button
            type="button"
            className={authPrimaryButtonClassName}
            disabled={isResending}
            onClick={() => {
              void handleResend();
            }}
          >
            {isResending ? t(locale, 'auth.signUp.resending') : t(locale, 'auth.signUp.resend')}
          </Button>
        </AuthPanel>
      </>
    );
  }

  return (
    <>
      {!embedded ? <AuthIntro title={t(locale, 'auth.signUp.title')} /> : null}

      <AuthPanel variant={embedded ? 'plain' : 'card'}>
        <div className={cn(embedded && authDialogSectionClassName)}>
          <form
            className={embedded ? authDialogFormClassName : 'space-y-4'}
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <div className={embedded ? authDialogFieldStackClassName : 'contents'}>
              <form.Field name="name">
                {(field) => (
                  <Field hideLabel={embedded} label={t(locale, 'auth.signUp.nameLabel')} htmlFor="sign-up-name">
                    <input
                      id="sign-up-name"
                      type="text"
                      autoComplete="name"
                      placeholder={
                        embedded
                          ? t(locale, 'auth.signUp.namePlaceholderEmbedded')
                          : t(locale, 'auth.signUp.namePlaceholder')
                      }
                      className={authInputClassName}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="username">
                {(field) => (
                  <Field hideLabel={embedded} label={t(locale, 'auth.signUp.usernameLabel')} htmlFor="sign-up-username">
                    <input
                      id="sign-up-username"
                      type="text"
                      autoComplete="username"
                      placeholder={
                        embedded
                          ? t(locale, 'auth.signUp.usernamePlaceholderEmbedded')
                          : t(locale, 'auth.signUp.usernamePlaceholder')
                      }
                      className={authInputClassName}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="email">
                {(field) => (
                  <Field hideLabel={embedded} label={t(locale, 'auth.signUp.emailLabel')} htmlFor="sign-up-email">
                    <input
                      id="sign-up-email"
                      type="email"
                      autoComplete="email"
                      placeholder={
                        embedded
                          ? t(locale, 'auth.signUp.emailPlaceholderEmbedded')
                          : t(locale, 'auth.signUp.emailPlaceholder')
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
                  <Field hideLabel={embedded} label={t(locale, 'auth.signUp.passwordLabel')} htmlFor="sign-up-password">
                    <input
                      id="sign-up-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        embedded
                          ? t(locale, 'auth.signUp.passwordPlaceholderEmbedded')
                          : t(locale, 'auth.signUp.passwordPlaceholder')
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

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" className={authPrimaryButtonClassName} disabled={isSubmitting}>
                  {isSubmitting ? t(locale, 'auth.signUp.submitting') : t(locale, 'auth.signUp.submit')}
                </Button>
              )}
            </form.Subscribe>
          </form>
          {embedded ? <AuthSocialLoginSection /> : null}
        </div>
      </AuthPanel>
    </>
  );
}
