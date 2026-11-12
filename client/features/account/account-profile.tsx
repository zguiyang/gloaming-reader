'use client';

import type { ReactNode } from 'react';

import { t } from '@gloaming/i18n';

import { formatAccountCreatedAt, resolveAccountUsername } from '@/features/account/account-model';
import { useLocale } from '@/lib/locale-context';
import type { User } from '@/lib/validations/auth';

type AccountProfileProps = {
  user: User;
};

function ProfileRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3.5 sm:grid-cols-[minmax(0,9rem)_1fr] sm:items-baseline sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function AccountProfile({ user }: AccountProfileProps) {
  const { locale } = useLocale();
  const username = resolveAccountUsername(user);

  return (
    <dl className="divide-y divide-border/40">
      <ProfileRow label={t(locale, 'account.profile.displayName')}>{user.name}</ProfileRow>
      {username ? <ProfileRow label={t(locale, 'account.profile.username')}>{username}</ProfileRow> : null}
      <ProfileRow label={t(locale, 'account.profile.email')}>{user.email}</ProfileRow>
      <ProfileRow label={t(locale, 'account.profile.emailVerified')}>
        <span className={user.emailVerified ? 'text-muted-foreground' : 'text-foreground/80'}>
          {user.emailVerified
            ? t(locale, 'account.profile.emailVerifiedYes')
            : t(locale, 'account.profile.emailVerifiedNo')}
        </span>
      </ProfileRow>
      <ProfileRow label={t(locale, 'account.profile.createdAt')}>
        {formatAccountCreatedAt(user.createdAt, locale)}
      </ProfileRow>
    </dl>
  );
}
