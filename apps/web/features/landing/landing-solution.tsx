'use client';

import { t } from '@gloaming/i18n';

import { LandingReveal } from '@/features/landing/landing-motion';
import { LandingShot } from '@/features/landing/landing-shot';
import { useLocale } from '@/lib/locale-context';

function BeatPoints({ prefix, count }: { prefix: string; count: number }) {
  const { locale } = useLocale();
  return (
    <ul className="space-y-2.5 text-sm font-medium text-foreground">
      {Array.from({ length: count }, (_, i) => String(i + 1)).map((key) => (
        <li key={key} className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          {t(locale, `${prefix}.${key}`)}
        </li>
      ))}
    </ul>
  );
}

export function LandingSolution() {
  const { locale } = useLocale();

  return (
    <section className="border-b border-outline-variant/70 py-20 md:py-28">
      <div className="mx-auto max-w-[1200px] px-6">
        <LandingReveal className="mb-16 max-w-xl">
          <span className="text-xs font-semibold tracking-wider text-primary uppercase">
            {t(locale, 'landing.solution.eyebrow')}
          </span>
          <h2 className="font-heading mt-2 mb-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {t(locale, 'landing.solution.title')}
          </h2>
          <p className="leading-relaxed text-muted-foreground">{t(locale, 'landing.solution.lead')}</p>
        </LandingReveal>

        <div className="space-y-24">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12" id="discover">
            <LandingReveal className="order-2 lg:order-1 lg:col-span-5">
              <div className="mb-3 inline-flex items-center gap-2 rounded bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {t(locale, 'landing.solution.beatA.label')}
              </div>
              <h3 className="font-heading mb-4 text-2xl font-bold text-foreground sm:text-3xl">
                {t(locale, 'landing.solution.beatA.title')}
              </h3>
              <p className="mb-6 text-base leading-relaxed text-muted-foreground">
                {t(locale, 'landing.solution.beatA.body')}
              </p>
              <BeatPoints prefix="landing.solution.beatA.points" count={2} />
            </LandingReveal>
            <LandingReveal delay={0.05} className="order-1 lg:order-2 lg:col-span-7">
              <LandingShot src="/landing/shot-discover.webp" alt={t(locale, 'landing.shot.discover')} />
            </LandingReveal>
          </div>

          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12" id="reader">
            <LandingReveal className="lg:col-span-5">
              <div className="mb-3 inline-flex items-center gap-2 rounded bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {t(locale, 'landing.solution.beatB.label')}
              </div>
              <h3 className="font-heading mb-4 text-2xl font-bold text-foreground sm:text-3xl">
                {t(locale, 'landing.solution.beatB.title')}
              </h3>
              <p className="mb-6 text-base leading-relaxed text-muted-foreground">
                {t(locale, 'landing.solution.beatB.body')}
              </p>
              <BeatPoints prefix="landing.solution.beatB.points" count={3} />
            </LandingReveal>
            <LandingReveal delay={0.05} className="lg:col-span-7">
              <LandingShot src="/landing/shot-reader-help.webp" alt={t(locale, 'landing.shot.readerHelp')} />
            </LandingReveal>
          </div>

          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12" id="library">
            <LandingReveal className="order-2 lg:order-1 lg:col-span-5">
              <div className="mb-3 inline-flex items-center gap-2 rounded bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {t(locale, 'landing.solution.beatC.label')}
              </div>
              <h3 className="font-heading mb-4 text-2xl font-bold text-foreground sm:text-3xl">
                {t(locale, 'landing.solution.beatC.title')}
              </h3>
              <p className="mb-6 text-base leading-relaxed text-muted-foreground">
                {t(locale, 'landing.solution.beatC.body')}
              </p>
              <BeatPoints prefix="landing.solution.beatC.points" count={2} />
            </LandingReveal>
            <LandingReveal delay={0.05} className="order-1 lg:order-2 lg:col-span-7">
              <LandingShot src="/landing/shot-library.webp" alt={t(locale, 'landing.shot.library')} />
            </LandingReveal>
          </div>
        </div>
      </div>
    </section>
  );
}
