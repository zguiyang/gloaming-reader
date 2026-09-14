import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/noto-serif-sc';
import './globals.css';

import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';

import { t } from '@gloaming/i18n';

import { Providers } from '@/components/providers';
import { APP_NAME } from '@/constants';
import { getClientLocale, LOCALE_COOKIE_NAME } from '@/lib/client-locale';

/**
 * Fonts: Fontsource variable packages (self-hosted woff2 via npm).
 * Avoid `next/font/google` — compile-time gstatic fetches hang behind fake-IP proxies.
 */

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = getClientLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  return {
    title: APP_NAME,
    description: t(locale, 'common.siteDescription'),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = getClientLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  return (
    <html lang={locale} className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
