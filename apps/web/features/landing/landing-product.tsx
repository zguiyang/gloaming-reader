'use client';

import { type Locale, t } from '@gloaming/i18n';

import { LandingHoverLift, LandingReveal } from '@/features/landing/landing-motion';
import { LandingCompanionCard, LandingFrameImage } from '@/features/landing/landing-product-mock';
import { LandingSection } from '@/features/landing/landing-section';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const FRICTION_PAST_KEYS = [
  'landing.friction.pastItem1',
  'landing.friction.pastItem2',
  'landing.friction.pastItem3',
  'landing.friction.pastItem4',
  'landing.friction.pastItem5',
] as const;

const FRICTION_NEXT_KEYS = [
  'landing.friction.nextItem1',
  'landing.friction.nextItem2',
  'landing.friction.nextItem3',
  'landing.friction.nextItem4',
  'landing.friction.nextItem5',
] as const;

function translateKeys(locale: Locale, keys: readonly string[]) {
  return keys.map((key) => t(locale, key));
}

function FeatureCopy({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-heading text-2xl font-semibold text-primary">{title}</h3>
      <p className="font-reading mt-6 max-w-md text-lg leading-relaxed text-foreground/80">{body}</p>
    </div>
  );
}

function JourneyColumn({ title, items, tone }: { title: string; items: readonly string[]; tone: 'past' | 'next' }) {
  return (
    <LandingHoverLift>
      <div
        className={cn(
          'relative h-full overflow-hidden rounded-3xl bg-card p-10 shadow-card ring-1 md:p-12',
          'transition-[box-shadow,ring-color,background-color] duration-200 ease-out-soft',
          'hover:bg-surface-container-lowest hover:shadow-float',
          tone === 'next' ? 'ring-primary/30 hover:ring-primary/45' : 'ring-border/40 hover:ring-border/70',
        )}
      >
        {tone === 'next' ? (
          <div className="pointer-events-none absolute -top-16 -right-16 size-32 rounded-bl-full bg-primary/5" />
        ) : null}
        <h4
          className={cn(
            'text-xs font-semibold tracking-[0.15em] uppercase',
            tone === 'next' ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {title}
        </h4>
        <ol className="font-reading mt-10 flex flex-col gap-8 text-lg leading-relaxed">
          {items.map((item, index) => {
            const isTurn = index === 1 || index === items.length - 1;
            return (
              <li key={item} className="flex items-center gap-4">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    tone === 'next'
                      ? isTurn
                        ? 'size-2.5 bg-primary'
                        : 'bg-primary/40'
                      : isTurn
                        ? 'bg-destructive/70'
                        : 'bg-outline/40',
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    tone === 'next'
                      ? isTurn
                        ? 'font-medium text-primary'
                        : 'text-foreground/80'
                      : isTurn
                        ? 'text-destructive/80'
                        : 'text-muted-foreground',
                  )}
                >
                  {item}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </LandingHoverLift>
  );
}

export function LandingProduct() {
  const { locale } = useLocale();

  return (
    <>
      <LandingSection id="reader" tone="card">
        <LandingReveal>
          <h2 className="font-heading text-center text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
            {t(locale, 'landing.product.title')}
          </h2>
        </LandingReveal>

        <div className="mt-24 flex flex-col gap-32">
          <LandingReveal className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
            <LandingFrameImage
              src="/landing/reader-ui.png"
              alt={t(locale, 'landing.product.readerImageAlt')}
              float
              readingAssist
            />
            <FeatureCopy
              title={t(locale, 'landing.product.readerTitle')}
              body={t(locale, 'landing.product.readerBody')}
            />
          </LandingReveal>

          <div id="companion" className="scroll-mt-20">
            <LandingReveal className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
              <div className="md:order-1">
                <FeatureCopy
                  title={t(locale, 'landing.product.companionTitle')}
                  body={t(locale, 'landing.product.companionBody')}
                />
              </div>
              <div className="md:order-2">
                <LandingCompanionCard />
              </div>
            </LandingReveal>
          </div>

          <div id="shelf" className="scroll-mt-20">
            <LandingReveal className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
              <LandingFrameImage src="/landing/shelf.jpg" alt={t(locale, 'landing.product.shelfImageAlt')} float />
              <FeatureCopy
                title={t(locale, 'landing.product.shelfTitle')}
                body={t(locale, 'landing.product.shelfBody')}
              />
            </LandingReveal>
          </div>
        </div>
      </LandingSection>

      <LandingSection id="friction">
        <LandingReveal>
          <div className="text-center">
            <h2 className="font-heading text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
              {t(locale, 'landing.friction.title')}
            </h2>
            <p className="font-reading mx-auto mt-6 max-w-2xl text-lg font-medium text-foreground/80">
              {t(locale, 'landing.friction.lead')}
            </p>
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl gap-8 md:grid-cols-2 md:gap-12">
            <JourneyColumn
              title={t(locale, 'landing.friction.pastTitle')}
              items={translateKeys(locale, FRICTION_PAST_KEYS)}
              tone="past"
            />
            <JourneyColumn
              title={t(locale, 'landing.friction.nextTitle')}
              items={translateKeys(locale, FRICTION_NEXT_KEYS)}
              tone="next"
            />
          </div>
        </LandingReveal>
      </LandingSection>
    </>
  );
}
