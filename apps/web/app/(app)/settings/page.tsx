import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';

import { t } from '@gloaming/i18n';

import { SettingsPage } from '@/features/settings/settings-page';
import { getClientLocale, LOCALE_COOKIE_NAME } from '@/lib/client-locale';

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = getClientLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
  return { title: t(locale, 'settings.metaTitle') };
}

export default function SettingsRoutePage() {
  return <SettingsPage />;
}
