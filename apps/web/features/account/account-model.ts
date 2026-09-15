import type { Locale } from '@gloaming/i18n';

import type { LinkedAccount } from '@/lib/auth/api';
import type { User } from '@/lib/validations/auth';

export function hasCredentialAccount(accounts: LinkedAccount[] | undefined): boolean {
  return accounts?.some((account) => account.providerId === 'credential') ?? false;
}

export function formatAccountCreatedAt(value: string | Date, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function resolveAccountUsername(user: User): string | null {
  const username = user.username?.trim();
  if (username) {
    return username;
  }
  const displayUsername = user.displayUsername?.trim();
  return displayUsername || null;
}
