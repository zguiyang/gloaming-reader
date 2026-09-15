'use client';

import { t } from '@gloaming/i18n';

import { LandingReveal } from '@/features/landing/landing-motion';
import { LandingCompanionCard, LandingFrameImage } from '@/features/landing/landing-product-mock';
import { LandingSection } from '@/features/landing/landing-section';
import { useLocale } from '@/lib/locale-context';

function FeatureCopy({ title, body }: { title: string; body?: string }) {
  return (
    <div>
      <h3 className="font-heading text-2xl font-semibold text-primary">{title}</h3>
      {body ? <p className="font-reading mt-6 max-w-md text-lg leading-relaxed text-foreground/80">{body}</p> : null}
    </div>
  );
}

export function LandingProduct() {
  const { locale } = useLocale();

  return (
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
          <FeatureCopy title={t(locale, 'landing.product.readerTitle')} />
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
  );
}
