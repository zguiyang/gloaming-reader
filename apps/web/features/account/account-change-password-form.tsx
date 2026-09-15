'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient, resolveAuthErrorMessage } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { changePasswordFormSchema } from '@/lib/validations/auth';

type AccountChangePasswordFormProps = {
  enabled: boolean;
  accountsPending: boolean;
};

export function AccountChangePasswordForm({ enabled, accountsPending }: AccountChangePasswordFormProps) {
  const { locale } = useLocale();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      currentPassword: '',
      password: '',
      passwordConfirm: '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const parsed = changePasswordFormSchema.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message =
          issue?.path.includes('passwordConfirm') && issue.code === 'custom'
            ? t(locale, 'auth.errors.passwordMismatch')
            : t(locale, 'auth.errors.invalidInput');
        setFormError(message);
        return;
      }

      const { error } = await authClient.changePassword({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.password,
      });

      if (error) {
        const message = resolveAuthErrorMessage(error, locale, 'account.password.failed');
        setFormError(message);
        toast.error(message);
        return;
      }

      form.reset();
      toast.success(t(locale, 'account.password.success'));
    },
  });

  if (accountsPending) {
    return (
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="h-11 animate-pulse rounded-md bg-surface-container-high" />
        <div className="h-11 animate-pulse rounded-md bg-surface-container-high" />
        <div className="h-11 animate-pulse rounded-md bg-surface-container-high" />
      </div>
    );
  }

  if (!enabled) {
    return <p className="text-sm text-muted-foreground">{t(locale, 'account.password.oauthOnly')}</p>;
  }

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="currentPassword">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="account-current-password">{t(locale, 'account.password.currentLabel')}</FieldLabel>
            <FieldContent>
              <Input
                id="account-current-password"
                type="password"
                autoComplete="current-password"
                className="h-11"
                disabled={accountsPending}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </FieldContent>
          </Field>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="account-new-password">{t(locale, 'account.password.newLabel')}</FieldLabel>
            <FieldContent>
              <Input
                id="account-new-password"
                type="password"
                autoComplete="new-password"
                className="h-11"
                disabled={accountsPending}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t(locale, 'account.password.minLengthHint')}</p>
            </FieldContent>
          </Field>
        )}
      </form.Field>

      <form.Field name="passwordConfirm">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="account-confirm-password">{t(locale, 'account.password.confirmLabel')}</FieldLabel>
            <FieldContent>
              <Input
                id="account-confirm-password"
                type="password"
                autoComplete="new-password"
                className="h-11"
                disabled={accountsPending}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </FieldContent>
          </Field>
        )}
      </form.Field>

      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button
            type="submit"
            className="h-11 w-full rounded-md sm:w-auto sm:min-w-40"
            disabled={isSubmitting || accountsPending}
          >
            {isSubmitting ? t(locale, 'account.password.submitting') : t(locale, 'account.password.submit')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
