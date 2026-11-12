import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';

import { t } from '@gloaming/i18n';

import { SiteNav } from '@/components/navigation';
import { LandingNavEntrance, LandingPage } from '@/features/landing';
import { getClientLocale, LOCALE_COOKIE_NAME } from '@/lib/client-locale';

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = getClientLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  return {
    title: t(locale, 'landing.meta.title'),
    description: t(locale, 'landing.meta.description'),
  };
}

export default function Home() {
  return (
    <div className="relative z-10 flex min-h-full flex-1 flex-col">
      <LandingNavEntrance>
        <SiteNav />
      </LandingNavEntrance>
      <LandingPage />
    </div>
  );
}
