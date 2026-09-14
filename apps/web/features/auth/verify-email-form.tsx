'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { authPrimaryButtonClassName } from '@/features/auth/auth-field';
import { AuthIntro, AuthPanel } from '@/features/auth/auth-layout';
import { authClient } from '@/lib/auth';
import { consumePostAuthPath } from '@/lib/auth/post-auth-redirect';
import { useLocale } from '@/lib/locale-context';

export function VerifyEmailForm() {
  const { locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>(() => (token ? 'pending' : 'error'));
  const [message, setMessage] = useState<string | undefined>(() =>
    token ? undefined : t(locale, 'auth.verifyEmail.invalidToken'),
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const { error } = await authClient.verifyEmail(token);
      if (cancelled) {
        return;
      }
      if (error) {
        setStatus('error');
        setMessage(error.message || t(locale, 'auth.verifyEmail.failed'));
        toast.error(error.message || t(locale, 'auth.verifyEmail.failedToast'));
        return;
      }
      setStatus('ok');
      setMessage(undefined);
      toast.success(t(locale, 'auth.verifyEmail.successToast'));
    })();

    return () => {
      cancelled = true;
    };
  }, [token, locale]);

  const title =
    status === 'ok'
      ? t(locale, 'auth.verifyEmail.titleSuccess')
      : status === 'error'
        ? t(locale, 'auth.verifyEmail.titleError')
        : t(locale, 'auth.verifyEmail.titlePending');

  return (
    <>
      <AuthIntro title={title} description={message} />

      {status !== 'pending' ? (
        <AuthPanel>
          {status === 'ok' ? (
            <Button
              type="button"
              className={authPrimaryButtonClassName}
              onClick={() => {
                router.replace(consumePostAuthPath(searchParams));
              }}
            >
              {t(locale, 'auth.verifyEmail.goToShelf')}
            </Button>
          ) : null}
          {status === 'error' ? (
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                className={authPrimaryButtonClassName}
                onClick={() => {
                  router.replace('/');
                }}
              >
                {t(locale, 'auth.verifyEmail.backToSignIn')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  router.replace('/');
                }}
              >
                {t(locale, 'auth.verifyEmail.backToProduct')}
              </Button>
            </div>
          ) : null}
        </AuthPanel>
      ) : null}
    </>
  );
}
