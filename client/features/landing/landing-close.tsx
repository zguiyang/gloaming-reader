'use client';

import { t } from '@gloaming/i18n';

import { LandingPrimaryCta } from '@/features/landing/landing-auth';
import { LandingReveal } from '@/features/landing/landing-motion';
import { useLocale } from '@/lib/locale-context';

export function LandingCta() {
  const { locale } = useLocale();

  return (
    <section className="py-24 md:py-32" id="cta">
      <div className="mx-auto max-w-[1200px] px-6 text-center">
        <LandingReveal className="mx-auto max-w-xl">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
            {t(locale, 'landing.invite.titleLine1')}
            <br />
            {t(locale, 'landing.invite.titleLine2')}
          </h2>
          <p className="mt-5 mb-9 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t(locale, 'landing.invite.body')}
          </p>
          <div className="flex justify-center">
            <LandingPrimaryCta size="lg" className="w-full sm:w-auto" />
          </div>
          <p className="mt-5 font-sans text-xs text-muted-foreground">{t(locale, 'landing.invite.footnote')}</p>
        </LandingReveal>
      </div>
    </section>
  );
}

export function LandingFooter() {
  const { locale } = useLocale();
  const year = new Date().getFullYear();
  const brand = t(locale, 'common.appName');

  return (
    <footer className="border-t border-outline-variant bg-background py-10">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="font-heading text-lg font-semibold text-foreground">{brand}</span>
          <span className="text-xs text-muted-foreground">· {t(locale, 'landing.footer.tagline')}</span>
        </div>
        <div className="font-sans text-xs text-muted-foreground">
          © {year} {brand}
        </div>
      </div>
    </footer>
  );
}
