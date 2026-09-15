import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';

import { t } from '@gloaming/i18n';

import { HistoryPage } from '@/features/history';
import { getClientLocale, LOCALE_COOKIE_NAME } from '@/lib/client-locale';

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = getClientLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  return {
    title: t(locale, 'content.history.metaTitle'),
  };
}

export default function ReadingHistoryRoutePage() {
  return <HistoryPage />;
}
