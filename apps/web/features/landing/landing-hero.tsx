'use client';

import { t } from '@gloaming/i18n';

import { LandingPrimaryCta } from '@/features/landing/landing-auth';
import { LandingAmbientGlow, LandingEntrance } from '@/features/landing/landing-motion';
import { LandingHeroReader } from '@/features/landing/landing-product-mock';
import { useLocale } from '@/lib/locale-context';

export function LandingHero() {
  const { locale } = useLocale();

  return (
    <header className="relative container flex flex-col items-center pt-24 pb-16 text-center md:pt-32 md:pb-20">
      <LandingAmbientGlow />

      <LandingEntrance delay={0.1}>
        <h1 className="font-heading max-w-3xl text-[2.25rem] leading-[1.15] font-bold tracking-tight sm:text-5xl md:text-[48px] md:leading-[56px]">
          {t(locale, 'landing.hero.title')}
        </h1>
      </LandingEntrance>

      <LandingEntrance delay={0.2}>
        <p className="font-reading mx-auto mt-8 max-w-2xl text-xl leading-8 text-foreground/70">
          {t(locale, 'landing.hero.subtitle')}
        </p>
      </LandingEntrance>

      <LandingEntrance delay={0.3} className="mt-12 flex justify-center">
        <LandingPrimaryCta />
      </LandingEntrance>

      <LandingEntrance delay={0.4} className="mt-16 w-full max-w-3xl md:mt-20">
        <LandingHeroReader />
      </LandingEntrance>
    </header>
  );
}
