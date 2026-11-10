'use client';

import { t } from '@gloaming/i18n';

import { useLocale } from '@/lib/locale-context';

export function HistoryHeader({ spaced = true }: { spaced?: boolean }) {
  const { locale } = useLocale();

  return (
    <header className={`w-full text-left md:text-center ${spaced ? 'mb-8 md:mb-10' : ''}`}>
      <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl md:leading-[1.15]">
        {t(locale, 'content.history.title')}
      </h1>
    </header>
  );
}
