'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient, resolveMailCooldownErrorMessage } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { changeEmailFormSchema } from '@/lib/validations/auth';

type AccountChangeEmailFormProps = {
  currentEmail: string;
};

export function AccountChangeEmailForm({ currentEmail }: AccountChangeEmailFormProps) {
  const { locale } = useLocale();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      newEmail: '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const parsed = changeEmailFormSchema.safeParse(value);
      if (!parsed.success) {
        setFormError(t(locale, 'auth.errors.invalidInput'));
        return;
      }

      if (parsed.data.newEmail.toLowerCase() === currentEmail.trim().toLowerCase()) {
        setFormError(t(locale, 'account.email.sameAsCurrent'));
        return;
      }

      const { error } = await authClient.changeEmail(parsed.data.newEmail);

      if (error) {
        const cooldownMessage = resolveMailCooldownErrorMessage(error);
        const message = cooldownMessage || error.message || t(locale, 'account.email.failed');
        setFormError(message);
        toast.error(message);
        return;
      }

      form.reset();
      toast.success(t(locale, 'account.email.success'));
    },
  });

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Field>
        <FieldLabel htmlFor="account-current-email">{t(locale, 'account.email.currentLabel')}</FieldLabel>
        <FieldContent>
          <Input id="account-current-email" type="email" className="h-11" value={currentEmail} readOnly disabled />
        </FieldContent>
      </Field>

      <form.Field name="newEmail">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="account-new-email">{t(locale, 'account.email.newLabel')}</FieldLabel>
            <FieldContent>
              <Input
                id="account-new-email"
                type="email"
                autoComplete="email"
                className="h-11"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldDescription>{t(locale, 'account.email.hint')}</FieldDescription>
            </FieldContent>
          </Field>
        )}
      </form.Field>

      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="h-11 w-full rounded-md sm:w-auto sm:min-w-40" disabled={isSubmitting}>
            {isSubmitting ? t(locale, 'account.email.submitting') : t(locale, 'account.email.submit')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
