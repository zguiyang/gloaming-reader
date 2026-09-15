'use client';

import { t } from '@gloaming/i18n';

import { LandingReveal } from '@/features/landing/landing-motion';
import { LandingSection } from '@/features/landing/landing-section';
import { useLocale } from '@/lib/locale-context';

export function LandingStory() {
  const { locale } = useLocale();

  return (
    <LandingSection id="contrast" tone="paper">
      <LandingReveal>
        <h2 className="font-heading mx-auto max-w-3xl text-center text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
          {t(locale, 'landing.contrast.title')}
        </h2>
        <p className="font-reading mx-auto mt-8 max-w-2xl text-center text-lg font-semibold text-foreground/80">
          {t(locale, 'landing.contrast.punch')}
        </p>
      </LandingReveal>
    </LandingSection>
  );
}
