import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/noto-serif-sc';
import './globals.css';

import type { Metadata } from 'next';

import { Providers } from '@/components/providers';

/**
 * Fonts: Fontsource variable packages (self-hosted woff2 via npm).
 * Avoid `next/font/google` — compile-time gstatic fetches hang behind fake-IP proxies.
 */

export const metadata: Metadata = {
  title: 'Gloaming client (migration scaffold)',
  description: 'Infrastructure smoke shell for the migration/ extract tree.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
