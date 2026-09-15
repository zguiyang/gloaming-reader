'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import {
  authDialogFormClassName,
  authInputClassName,
  authPrimaryButtonClassName,
  Field,
} from '@/features/auth/auth-field';
import { AuthFooterAction, AuthIntro, AuthPanel } from '@/features/auth/auth-layout';
import { authClient, resolveAuthErrorMessage } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { forgotPasswordSchema } from '@/lib/validations';

type ForgotPasswordFormProps = {
  embedded?: boolean;
  onSwitchMode?: (mode: 'login') => void;
};

export function ForgotPasswordForm({ embedded = false, onSwitchMode }: ForgotPasswordFormProps) {
  const { locale } = useLocale();
  const [isSent, setIsSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const parsed = forgotPasswordSchema.safeParse(value);
      if (!parsed.success) {
        setFormError(t(locale, 'auth.errors.invalidInput'));
        return;
      }

      const { error } = await authClient.forgotPassword(parsed.data.email);

      if (error) {
        const message = resolveAuthErrorMessage(error, locale, 'auth.errors.sendFailed');
        setFormError(message);
        toast.error(message);
        return;
      }

      setIsSent(true);
    },
  });

  if (isSent) {
    return (
      <>
        {!embedded ? (
          <AuthIntro
            title={t(locale, 'auth.forgotPassword.sentTitle')}
            description={t(locale, 'auth.forgotPassword.sentDescription')}
          />
        ) : null}

        <AuthPanel variant={embedded ? 'plain' : 'card'}>
          <Button
            type="button"
            className={authPrimaryButtonClassName}
            onClick={() => {
              setIsSent(false);
              setFormError(null);
            }}
          >
            {t(locale, 'auth.forgotPassword.enterDifferentEmail')}
          </Button>
        </AuthPanel>

        <AuthFooterAction
          className={embedded ? 'mt-5' : undefined}
          label={t(locale, 'auth.forgotPassword.backToSignIn')}
          onClick={() => onSwitchMode?.('login')}
        />
      </>
    );
  }

  return (
    <>
      {!embedded ? (
        <AuthIntro
          title={t(locale, 'auth.forgotPassword.title')}
          description={t(locale, 'auth.forgotPassword.description')}
        />
      ) : null}

      <AuthPanel variant={embedded ? 'plain' : 'card'}>
        <form
          className={embedded ? authDialogFormClassName : 'space-y-4'}
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <Field hideLabel={embedded} label={t(locale, 'auth.forgotPassword.emailLabel')} htmlFor="forgot-email">
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder={
                    embedded
                      ? t(locale, 'auth.forgotPassword.emailPlaceholderEmbedded')
                      : t(locale, 'auth.forgotPassword.emailPlaceholder')
                  }
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
                {isSubmitting ? t(locale, 'auth.forgotPassword.submitting') : t(locale, 'auth.forgotPassword.submit')}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </AuthPanel>

      <AuthFooterAction
        className={embedded ? 'mt-5' : undefined}
        label={t(locale, 'auth.forgotPassword.backToSignIn')}
        onClick={() => onSwitchMode?.('login')}
      />
    </>
  );
}
