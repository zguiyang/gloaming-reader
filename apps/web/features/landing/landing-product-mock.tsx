'use client';

import { SparklesIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import Image from 'next/image';

import { t } from '@gloaming/i18n';

import { landingEase, LandingHoverLift, LandingQuietFloat } from '@/features/landing/landing-motion';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function ReadingAssistOverlay() {
  const { locale } = useLocale();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl max-md:hidden" aria-hidden>
      <motion.div
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-primary-foreground/25 to-transparent mix-blend-soft-light"
        initial={{ x: '-40%', opacity: 0 }}
        animate={{ x: ['-40%', '140%'], opacity: [0, 0.55, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 4 }}
      />

      <motion.div
        className="absolute top-[38%] left-[18%] h-[1.1em] w-[22%] rounded-sm bg-primary/15"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.85, 0.85, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.15, 0.7, 1], repeatDelay: 3 }}
      />

      <motion.div
        className="absolute top-[32%] right-[10%] max-w-[9.5rem] rounded-xl bg-card/95 px-3 py-2 text-left shadow-card ring-1 ring-border/50"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: [0, 0, 1, 1, 0], y: [6, 6, 0, 0, 4] }}
        transition={{
          duration: 7,
          repeat: Infinity,
          ease: landingEase,
          times: [0, 0.25, 0.35, 0.8, 1],
          repeatDelay: 2.5,
        }}
      >
        <p className="text-[10px] font-medium tracking-wide text-primary uppercase">
          {t(locale, 'landing.product.companionCardTitle')}
        </p>
      </motion.div>
    </div>
  );
}

export function LandingFrameImage({
  src,
  alt,
  priority = false,
  float = false,
  readingAssist = false,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  float?: boolean;
  readingAssist?: boolean;
}) {
  const frame = (
    <div
      className={cn(
        'relative aspect-[16/10] overflow-hidden rounded-2xl shadow-card ring-1 ring-border/20',
        'transition-[box-shadow] duration-300 ease-out-soft',
        float && 'md:shadow-float',
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover object-top"
        sizes="(min-width: 768px) 32rem, 100vw"
        loading={priority ? 'eager' : 'lazy'}
        priority={priority}
      />
      {readingAssist ? <ReadingAssistOverlay /> : null}
    </div>
  );

  if (!float) {
    return frame;
  }

  return <LandingQuietFloat>{frame}</LandingQuietFloat>;
}

/** Hero product plane — same reader UI, quiet float + assist cue. */
export function LandingHeroReader() {
  const { locale } = useLocale();

  return (
    <LandingFrameImage
      src="/landing/reader-ui.png"
      alt={t(locale, 'landing.product.readerImageAlt')}
      priority
      float
      readingAssist
    />
  );
}

export function LandingCompanionCard() {
  const { locale } = useLocale();

  return (
    <LandingHoverLift>
      <div
        className={cn(
          'rounded-3xl bg-background p-8 shadow-card ring-1 ring-border/40 md:p-10',
          'transition-[background-color,box-shadow,ring-color] duration-200 ease-out-soft',
          'hover:bg-surface-container-low hover:shadow-float hover:ring-primary/25',
        )}
      >
        <div className="flex gap-6">
          <SparklesIcon className="size-8 shrink-0 text-primary" strokeWidth={1.5} aria-hidden />
          <div>
            <h4 className="text-lg font-semibold">{t(locale, 'landing.product.companionCardTitle')}</h4>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              {t(locale, 'landing.product.companionCardBody')}
            </p>
          </div>
        </div>
      </div>
    </LandingHoverLift>
  );
}
