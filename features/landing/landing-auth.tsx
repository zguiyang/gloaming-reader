'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { t } from '@/i18n';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import { landingDuration, landingEase } from '@/features/landing/landing-motion';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function useLandingUser() {
  const { data, isPending } = authClient.useSession();
  return { user: data?.user ?? null, isPending };
}

type LandingPrimaryCtaProps = {
  className?: string;
  size?: 'default' | 'lg';
};

export function LandingPrimaryCta({ className, size = 'default' }: LandingPrimaryCtaProps) {
  const { locale } = useLocale();
  const { user, isPending } = useLandingUser();
  const { openLogin } = useAuthDialog();
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const label = user ? t(locale, 'landing.cta.goToLibrary') : t(locale, 'landing.cta.startReading');

  if (isPending) {
    return <Skeleton className={cn('rounded-xl', size === 'lg' ? 'h-14 w-44' : 'h-12 w-40', className)} />;
  }

  const button = (
    <Button
      type="button"
      className={cn(
        'h-auto rounded-xl bg-primary font-medium text-primary-foreground',
        'shadow-card transition-[background-color,box-shadow,transform] duration-200 ease-out-soft',
        'hover:bg-brand-deep hover:shadow-float',
        size === 'lg' ? 'px-8 py-4 text-base' : 'inline-flex items-center gap-2 px-6 py-3.5 text-base',
        className,
      )}
      onClick={() => {
        if (user) {
          router.push(AUTH_ROUTES.library);
        } else {
          openLogin();
        }
      }}
    >
      <span>{label}</span>
      <span aria-hidden className="text-primary-foreground/90">
        →
      </span>
    </Button>
  );

  if (shouldReduceMotion) {
    return button;
  }

  return (
    <motion.div
      className="inline-flex will-change-transform"
      whileHover={{ y: -1, transition: { duration: landingDuration.feedback, ease: landingEase } }}
      whileTap={{ scale: 0.98, transition: { duration: landingDuration.feedback, ease: landingEase } }}
    >
      {button}
    </motion.div>
  );
}

export function LandingDiscoverLink({ className }: { className?: string }) {
  const { locale } = useLocale();

  return (
    <Link
      href={AUTH_ROUTES.discover}
      className={cn(
        'rounded-xl border border-transparent px-5 py-3.5 text-base font-medium text-muted-foreground',
        'transition-colors hover:border-outline-variant hover:bg-paper hover:text-foreground',
        className,
      )}
    >
      {t(locale, 'landing.cta.browseDiscover')}
    </Link>
  );
}
