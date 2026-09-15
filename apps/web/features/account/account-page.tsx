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

function AccountHeader() {
  const { locale } = useLocale();

  return (
    <header className="mb-2 border-b border-border/40 pb-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        {t(locale, 'account.title')}
      </h1>
    </header>
  );
}

function AccountSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden>
      <div className="border-b border-border/50 py-6">
        <div className="mb-4 h-4 w-24 animate-pulse rounded bg-surface-container-high" />
        <div className="flex flex-col gap-3">
          <div className="h-4 w-full max-w-xs animate-pulse rounded bg-surface-container-high" />
          <div className="h-4 w-full max-w-sm animate-pulse rounded bg-surface-container-high" />
          <div className="h-4 w-full max-w-xs animate-pulse rounded bg-surface-container-high" />
        </div>
      </div>
      <div className="border-b border-border/50 py-6">
        <div className="mb-4 h-4 w-20 animate-pulse rounded bg-surface-container-high" />
        <div className="flex flex-col gap-3">
          <div className="h-11 animate-pulse rounded-md bg-surface-container-high" />
          <div className="h-11 animate-pulse rounded-md bg-surface-container-high" />
        </div>
      </div>
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
      <div className="mx-auto flex w-full max-w-2xl flex-col">
        <AccountHeader />
        <AccountSkeleton />
      </div>
    );
  }

  const user = session.data?.user;
  if (!user) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col">
        <AccountHeader />
        <AccountSkeleton />
      </div>
    );
  }

  const canChangePassword = linkedAccountsQuery.isSuccess && hasCredentialAccount(linkedAccountsQuery.data);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <AccountHeader />

      <div className="flex flex-col">
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
    </div>
  );
}
