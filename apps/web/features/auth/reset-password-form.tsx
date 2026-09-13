'use client';

import { useForm } from '@tanstack/react-form';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { authInputClassName, authPrimaryButtonClassName, Field } from '@/features/auth/auth-field';
import { AuthFooterLink, AuthIntro, AuthPanel } from '@/features/auth/auth-layout';
import { authClient } from '@/lib/auth';
import { consumePostAuthPath } from '@/lib/auth/post-auth-redirect';
import { resetPasswordSchema } from '@/lib/validations';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const tokenError = searchParams.get('error');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || tokenError === 'INVALID_TOKEN') {
      toast.error('重置链接无效或已过期，请重新申请');
      router.replace('/');
    }
  }, [token, tokenError, router]);

  const form = useForm({
    defaultValues: {
      password: '',
      passwordConfirm: '',
    },
    onSubmit: async ({ value }) => {
      if (!token) {
        router.replace('/');
        return;
      }

      setFormError(null);
      const parsed = resetPasswordSchema.safeParse(value);
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? '输入有误');
        return;
      }

      const { error } = await authClient.resetPassword({
        password: parsed.data.password,
        token,
      });

      if (error) {
        const message = error.message || '重置失败，请重新申请链接';
        setFormError(message);
        toast.error(message);
        return;
      }

      toast.success('密码已更新');
      router.replace(consumePostAuthPath(searchParams));
    },
  });

  if (!token || tokenError === 'INVALID_TOKEN') {
    return null;
  }

  return (
    <>
      <AuthIntro title="设置新密码" />

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
              <Field label="新密码" htmlFor="reset-password">
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder="至少 8 位"
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
              <Field label="再输入一次" htmlFor="reset-password-confirm">
                <input
                  id="reset-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder="再输入一次新密码"
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
                {isSubmitting ? '保存中…' : '保存新密码'}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </AuthPanel>

      <AuthFooterLink href="/" label="返回产品" />
    </>
  );
}
