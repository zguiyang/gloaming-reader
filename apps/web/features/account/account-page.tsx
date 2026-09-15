'use client';

import { useEffect } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { useLinkedAccountsQuery } from '@/features/account/account-api';
import { AccountChangeEmailForm } from '@/features/account/account-change-email-form';
import { AccountChangePasswordForm } from '@/features/account/account-change-password-form';
import { hasCredentialAccount } from '@/features/account/account-model';
import { AccountProfile } from '@/features/account/account-profile';
import { AccountSection } from '@/features/account/account-section';
import { useAuthDialog } from '@/features/auth';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function AccountHeader() {
  const { locale } = useLocale();

  return (
    <header className="mb-8 w-full text-left md:mb-10 md:text-center">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl md:leading-[1.15]">
        {t(locale, 'account.title')}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground md:mt-4 md:font-heading md:text-xl md:leading-8">
        {t(locale, 'account.subtitle')}
      </p>
    </header>
  );
}

function AccountSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-56 animate-pulse rounded-xl bg-surface-container-high" />
      <div className="h-72 animate-pulse rounded-xl bg-surface-container-high" />
      <div className="h-64 animate-pulse rounded-xl bg-surface-container-high" />
    </div>
  );
}

export function AccountPage() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const session = authClient.useSession();
  const linkedAccountsQuery = useLinkedAccountsQuery({ enabled: Boolean(session.data?.user) });

  useEffect(() => {
    if (!session.isPending && session.error?.status === 401) {
      openLogin();
    }
  }, [openLogin, session.error?.status, session.isPending]);

  if (session.isPending) {
    return (
      <div className="flex w-full flex-col">
        <AccountHeader />
        <AccountSkeleton />
      </div>
    );
  }

  const user = session.data?.user;
  if (!user) {
    return (
      <div className="flex w-full flex-col">
        <AccountHeader />
        <AccountSkeleton />
      </div>
    );
  }

  const canChangePassword = linkedAccountsQuery.isSuccess && hasCredentialAccount(linkedAccountsQuery.data);

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'mx-auto flex w-full max-w-2xl flex-col gap-6 md:gap-8',
      )}
    >
      <AccountHeader />

      <AccountSection title={t(locale, 'account.profile.sectionTitle')}>
        <AccountProfile user={user} />
      </AccountSection>

      <AccountSection title={t(locale, 'account.password.sectionTitle')}>
        {linkedAccountsQuery.isError ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t(locale, 'account.password.accountsLoadFailed')}</p>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-md sm:w-auto sm:min-w-32"
              onClick={() => void linkedAccountsQuery.refetch()}
            >
              {t(locale, 'content.common.retry')}
            </Button>
          </div>
        ) : (
          <AccountChangePasswordForm enabled={canChangePassword} accountsPending={linkedAccountsQuery.isPending} />
        )}
      </AccountSection>

      <AccountSection title={t(locale, 'account.email.sectionTitle')}>
        <AccountChangeEmailForm currentEmail={user.email} />
      </AccountSection>
    </div>
  );
}
