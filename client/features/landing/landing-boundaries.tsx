'use client';

import { t } from '@/i18n';

import { LandingReveal } from '@/features/landing/landing-motion';
import { useLocale } from '@/lib/locale-context';

const ITEM_KEYS = ['1', '2', '3', '4'] as const;

export function LandingBoundaries() {
  const { locale } = useLocale();

  return (
    <section className="border-b border-outline-variant/70 bg-paper/30 py-20 md:py-28">
      <div className="mx-auto max-w-[1200px] px-6">
        <LandingReveal className="mx-auto mb-14 max-w-2xl text-center">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {t(locale, 'landing.boundaries.eyebrow')}
          </span>
          <h2 className="font-heading mt-2 mb-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {t(locale, 'landing.boundaries.title')}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">{t(locale, 'landing.boundaries.lead')}</p>
        </LandingReveal>

        <LandingReveal className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          {ITEM_KEYS.map((key) => (
            <div
              key={key}
              className="flex items-start gap-3.5 rounded-[14px] border border-outline-variant bg-card p-6"
            >
              <span className="font-heading text-base text-muted-foreground" aria-hidden>
                ✕
              </span>
              <div>
                <h3 className="mb-1 text-base font-medium text-foreground">
                  {t(locale, `landing.boundaries.items.${key}.title`)}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(locale, `landing.boundaries.items.${key}.body`)}
                </p>
              </div>
            </div>
          ))}
        </LandingReveal>
      </div>
    </section>
  );
}
