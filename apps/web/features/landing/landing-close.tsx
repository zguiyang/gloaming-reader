'use client';

import { t } from '@gloaming/i18n';

import { LandingPrimaryCta } from '@/features/landing/landing-auth';
import { LandingReveal } from '@/features/landing/landing-motion';
import { LandingSection } from '@/features/landing/landing-section';
import { useLocale } from '@/lib/locale-context';

const FOOTER_LINKS = [
  { href: '#philosophy', key: 'landing.footer.philosophy' },
  { href: '#origin', key: 'landing.footer.about' },
] as const;

export function LandingCta() {
  const { locale } = useLocale();

  return (
    <LandingSection id="cta" tone="paper" className="text-center">
      <LandingReveal className="mx-auto max-w-3xl">
        <h2 className="font-heading text-3xl leading-tight font-bold tracking-tight md:text-5xl">
          {t(locale, 'landing.invite.title')}
        </h2>
        <p className="font-reading mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-foreground/80 md:text-xl">
          {t(locale, 'landing.invite.body')}
        </p>
        <div className="mt-12 flex justify-center">
          <LandingPrimaryCta className="px-10 py-5 text-lg" />
        </div>
      </LandingReveal>
    </LandingSection>
  );
}

export function LandingFooter() {
  const { locale } = useLocale();
  const year = new Date().getFullYear();
  const brand = t(locale, 'common.appName');

  return (
    <footer className="border-t border-border/60 bg-card">
      <div className="container flex flex-col items-center justify-between gap-6 py-8 md:flex-row">
        <p className="font-heading text-2xl font-semibold text-foreground">{brand}</p>
        <p className="text-sm text-muted-foreground">
          © {year} {brand}. {t(locale, 'landing.footer.tagline')}
        </p>
        <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="transition-colors duration-300 ease-out-soft hover:text-primary"
            >
              {t(locale, link.key)}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
