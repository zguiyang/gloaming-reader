import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/noto-serif-sc';
import './globals.css';

import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';

import { Providers } from '@/components/providers';
import { APP_NAME } from '@/constants';
import { getClientLocale, LOCALE_COOKIE_NAME } from '@/lib/client-locale';

/**
 * Fonts: Fontsource variable packages (self-hosted woff2 via npm).
 * Avoid `next/font/google` — compile-time gstatic fetches hang behind fake-IP proxies.
 */

export const metadata: Metadata = {
  title: APP_NAME,
  description: '读自己想读的英语',
};

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
