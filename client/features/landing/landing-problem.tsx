'use client';

import { t } from '@/i18n';

import { LandingReveal } from '@/features/landing/landing-motion';
import { LandingShot } from '@/features/landing/landing-shot';
import { useLocale } from '@/lib/locale-context';

const ITEM_KEYS = ['1', '2', '3'] as const;

export function LandingProblem() {
  const { locale } = useLocale();

  return (
    <section className="border-b border-outline-variant/70 py-20 md:py-28">
      <div className="mx-auto max-w-[1200px] px-6">
        <LandingReveal className="mb-12 max-w-xl">
          <span className="text-xs font-semibold tracking-wider text-primary uppercase">
            {t(locale, 'landing.problem.eyebrow')}
          </span>
          <h2 className="font-heading mt-2 mb-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {t(locale, 'landing.problem.title')}
          </h2>
          <p className="leading-relaxed text-muted-foreground">{t(locale, 'landing.problem.lead')}</p>
        </LandingReveal>

        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
          <LandingReveal className="space-y-4 lg:col-span-5">
            {ITEM_KEYS.map((key) => (
              <div key={key} className="rounded-[14px] border border-outline-variant/80 bg-paper p-6">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-secondary text-xs font-medium text-muted-foreground">
                    {key}
                  </span>
                  <div>
                    <h3 className="mb-1 text-base font-medium text-foreground">
                      {t(locale, `landing.problem.items.${key}.title`)}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {t(locale, `landing.problem.items.${key}.body`)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </LandingReveal>

          <LandingReveal delay={0.06} className="lg:col-span-7">
            <LandingShot src="/landing/shot-help.webp" alt={t(locale, 'landing.shot.help')} />
          </LandingReveal>
        </div>
      </div>
    </section>
  );
}
