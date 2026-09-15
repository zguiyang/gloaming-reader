'use client';

import { t } from '@gloaming/i18n';

import { useLocale } from '@/lib/locale-context';

export function HistoryHeader() {
  const { locale } = useLocale();

  return (
    <header className="mb-8 w-full text-left md:mb-10 md:text-center">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl md:leading-[1.15]">
        {t(locale, 'content.history.title')}
      </h1>
    </header>
  );
}
