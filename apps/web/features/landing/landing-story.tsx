'use client';

import { CheckIcon, MinusIcon } from 'lucide-react';
import Image from 'next/image';

import { type Locale, t } from '@gloaming/i18n';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LandingHoverLift, LandingReveal } from '@/features/landing/landing-motion';
import { LandingSection } from '@/features/landing/landing-section';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const CONTRAST_PAST_KEYS = [
  'landing.contrast.pastItem1',
  'landing.contrast.pastItem2',
  'landing.contrast.pastItem3',
] as const;
const CONTRAST_NEXT_KEYS = [
  'landing.contrast.nextItem1',
  'landing.contrast.nextItem2',
  'landing.contrast.nextItem3',
] as const;

const PHILOSOPHY_ITEMS = [
  { titleKey: 'landing.philosophy.authenticTitle', bodyKey: 'landing.philosophy.authenticBody' },
  { titleKey: 'landing.philosophy.focusTitle', bodyKey: 'landing.philosophy.focusBody' },
  { titleKey: 'landing.philosophy.assistTitle', bodyKey: 'landing.philosophy.assistBody' },
] as const;

function translateKeys(locale: Locale, keys: readonly string[]) {
  return keys.map((key) => t(locale, key));
}

function ContrastCard({ title, items, tone }: { title: string; items: readonly string[]; tone: 'past' | 'next' }) {
  const Icon = tone === 'next' ? CheckIcon : MinusIcon;
  return (
    <LandingHoverLift>
      <Card
        className={cn(
          'relative h-full overflow-hidden rounded-3xl py-0 shadow-card',
          'transition-[box-shadow,ring-color,background-color] duration-200 ease-out-soft',
          'hover:shadow-float hover:ring-1',
          tone === 'next' ? 'ring-primary/30 hover:ring-primary/45' : 'hover:ring-border/60',
        )}
      >
        {tone === 'next' ? (
          <div className="pointer-events-none absolute -top-16 -right-16 size-32 rounded-bl-full bg-primary/5" />
        ) : null}
        <CardHeader className="px-10 pt-10 md:px-12 md:pt-12">
          <CardTitle
            className={cn(
              'font-heading text-xl font-semibold md:text-2xl',
              tone === 'next' ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-10 pb-10 md:px-12 md:pb-12">
          <ul className="flex flex-col gap-6">
            {items.map((item) => (
              <li key={item} className="font-reading flex items-start gap-3 text-lg leading-relaxed">
                <Icon
                  className={cn('mt-1 size-5 shrink-0', tone === 'next' ? 'text-primary' : 'text-outline/70')}
                  strokeWidth={1.5}
                  aria-hidden
                />
                <span className={tone === 'next' ? 'text-foreground' : 'text-muted-foreground'}>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </LandingHoverLift>
  );
}

export function LandingStory() {
  const { locale } = useLocale();
  const originParagraphs = [t(locale, 'landing.origin.paragraph1'), t(locale, 'landing.origin.paragraph2')];
  const leadSecondary = t(locale, 'landing.philosophy.leadSecondary');

  return (
    <>
      <LandingSection id="origin">
        <LandingReveal className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="relative order-1 aspect-[4/3] overflow-hidden rounded-2xl shadow-card ring-1 ring-border/20 md:order-2">
            <Image
              src="/landing/origin.jpg"
              alt={t(locale, 'landing.origin.imageAlt')}
              fill
              className="object-cover"
              sizes="(min-width: 768px) 32rem, 100vw"
            />
          </div>
          <div className="order-2 md:order-1">
            <h2 className="font-heading text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
              {t(locale, 'landing.origin.title')}
            </h2>
            <div className="font-reading mt-8 flex flex-col gap-6 text-lg leading-8 text-foreground/80">
              {originParagraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </div>
        </LandingReveal>
      </LandingSection>

      <LandingSection id="contrast" tone="paper">
        <LandingReveal>
          <h2 className="font-heading mx-auto max-w-3xl text-center text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
            {t(locale, 'landing.contrast.title')}
          </h2>
          <div className="mx-auto mt-16 grid max-w-5xl gap-8 md:grid-cols-2">
            <ContrastCard
              title={t(locale, 'landing.contrast.pastTitle')}
              items={translateKeys(locale, CONTRAST_PAST_KEYS)}
              tone="past"
            />
            <ContrastCard
              title={t(locale, 'landing.contrast.nextTitle')}
              items={translateKeys(locale, CONTRAST_NEXT_KEYS)}
              tone="next"
            />
          </div>
          <p className="font-reading mx-auto mt-16 max-w-2xl text-center text-lg font-semibold text-foreground/80">
            {t(locale, 'landing.contrast.punch')}
          </p>
        </LandingReveal>
      </LandingSection>

      <LandingSection id="philosophy">
        <LandingReveal>
          <div className="text-center">
            <h2 className="font-heading text-4xl leading-tight font-bold tracking-tight md:text-[56px] md:leading-[64px]">
              {t(locale, 'landing.philosophy.title')}
            </h2>
            <p className="font-reading mx-auto mt-8 max-w-3xl text-xl leading-relaxed text-muted-foreground md:text-2xl">
              {t(locale, 'landing.philosophy.lead')}
            </p>
            {leadSecondary ? <p className="mt-4 text-lg text-muted-foreground/70">{leadSecondary}</p> : null}
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl gap-12 border-t border-border/70 pt-16 text-left md:grid-cols-3">
            {PHILOSOPHY_ITEMS.map((item) => (
              <div key={item.titleKey}>
                <h3 className="font-heading text-xl font-semibold text-primary md:text-2xl">
                  {t(locale, item.titleKey)}
                </h3>
                <p className="font-reading mt-3 text-lg leading-relaxed text-foreground/80">
                  {t(locale, item.bodyKey)}
                </p>
              </div>
            ))}
          </div>
        </LandingReveal>
      </LandingSection>
    </>
  );
}
