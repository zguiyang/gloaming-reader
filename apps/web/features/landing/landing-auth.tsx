'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import { landingDuration, landingEase } from '@/features/landing/landing-motion';
import { authClient } from '@/lib/auth';
import { cn } from '@/lib/utils';

function useLandingUser() {
  const { data, isPending } = authClient.useSession();
  return { user: data?.user ?? null, isPending };
}

type LandingPrimaryCtaProps = {
  label: string;
  className?: string;
};

export function LandingPrimaryCta({ label, className }: LandingPrimaryCtaProps) {
  const { user, isPending } = useLandingUser();
  const { openLogin } = useAuthDialog();
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();

  if (isPending) {
    return <Skeleton className={cn('h-14 w-40 rounded-xl', className)} />;
  }

  const button = (
    <Button
      type="button"
      className={cn(
        'h-auto rounded-xl bg-primary px-8 py-4 text-base font-medium text-primary-foreground',
        'shadow-card transition-[background-color,box-shadow,transform] duration-200 ease-out-soft',
        'hover:bg-brand-deep hover:shadow-float',
        className,
      )}
      onClick={() => {
        if (user) {
          router.push(AUTH_ROUTES.shelf);
        } else {
          openLogin();
        }
      }}
    >
      {label}
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
