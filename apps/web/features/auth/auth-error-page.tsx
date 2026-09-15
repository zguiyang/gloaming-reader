'use client';

import { AlertCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { AuthIntro, AuthPanel } from '@/features/auth/auth-layout';
import { clearAuthReturnPath, resolvePostAuthPath } from '@/lib/auth/post-auth-redirect';
import { useLocale } from '@/lib/locale-context';

const SOCIAL_ERROR_COPY: Record<string, string> = {
  account_not_linked: 'auth.social.accountNotLinked',
  email_not_found: 'auth.social.emailNotFound',
  email_not_verified: 'auth.social.emailNotVerified',
};

export function AuthErrorPage() {
  const { locale } = useLocale();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get('error')?.toLowerCase() ?? '';
  const descriptionKey = SOCIAL_ERROR_COPY[errorCode] ?? 'auth.social.errorDescription';
  const returnPath = resolvePostAuthPath(searchParams);

  useEffect(() => {
    clearAuthReturnPath();
  }, []);

  return (
    <>
      <AuthIntro title={t(locale, 'auth.social.errorTitle')} description={t(locale, descriptionKey)} />

      <AuthPanel>
        <div className="flex flex-col items-center gap-5 text-center">
          <AlertCircleIcon className="size-8 text-destructive" strokeWidth={1.5} aria-hidden />
          <div className="flex w-full flex-col gap-3">
            <Button nativeButton={false} render={<Link href={returnPath} />}>
              {t(locale, 'auth.social.backToPrevious')}
            </Button>
            <Button nativeButton={false} variant="outline" render={<Link href={AUTH_ROUTES.discover} />}>
              {t(locale, 'auth.social.backToProduct')}
            </Button>
          </div>
        </div>
      </AuthPanel>
    </>
  );
}
