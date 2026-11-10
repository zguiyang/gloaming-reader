'use client';

import { t } from '@gloaming/i18n';

import { LandingDiscoverLink, LandingPrimaryCta } from '@/features/landing/landing-auth';
import { LandingReveal } from '@/features/landing/landing-motion';
import { LandingShot } from '@/features/landing/landing-shot';
import { useLocale } from '@/lib/locale-context';

export function LandingOpening() {
  const { locale } = useLocale();

  return (
    <section className="border-b border-outline-variant/70 pt-16 pb-20 md:pt-24 md:pb-28">
      <div className="mx-auto max-w-[1200px] px-6">
        <LandingReveal className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            {t(locale, 'landing.opening.eyebrow')}
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-[46px] md:leading-[1.22]">
            {t(locale, 'landing.opening.titleLine1')}
            <br className="hidden sm:inline" />
            {t(locale, 'landing.opening.titleLine2')}
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t(locale, 'landing.opening.body1')}
          </p>
          <p className="mt-4 mb-9 text-base leading-relaxed font-medium text-foreground sm:text-lg">
            {t(locale, 'landing.opening.body2')}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <LandingPrimaryCta />
            <LandingDiscoverLink />
          </div>
        </LandingReveal>

        <LandingReveal delay={0.08} className="mt-14">
          <LandingShot lift src="/landing/shot-reader.webp" alt={t(locale, 'landing.shot.reader')} />
        </LandingReveal>
      </div>
    </section>
  );
}
