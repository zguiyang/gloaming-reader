'use client';

import { type HTMLMotionProps, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/** Quiet editorial easing — landing brief. */
export const landingEase = [0.22, 1, 0.36, 1] as const;

export const landingDuration = {
  feedback: 0.18,
  content: 0.45,
  section: 0.55,
} as const;

function useIsDesktopMotion() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return isDesktop;
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
};

export function LandingReveal({ children, className, delay = 0, distance = 24 }: RevealProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18, margin: '0px 0px -6% 0px' }}
      transition={{ duration: landingDuration.section, delay, ease: landingEase }}
    >
      {children}
    </motion.div>
  );
}

export function LandingNavEntrance({ children, className }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: landingDuration.content, ease: landingEase }}
    >
      {children}
    </motion.div>
  );
}

export function LandingHoverLift({ children, className }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={cn('will-change-transform', className)}
      whileHover={{
        y: -4,
        transition: { duration: landingDuration.feedback, ease: landingEase },
      }}
    >
      {children}
    </motion.div>
  );
}

export function LandingQuietFloat({ children, className }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();
  const isDesktop = useIsDesktopMotion();

  if (shouldReduceMotion || !isDesktop) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={cn('will-change-transform', className)}
      animate={{ y: [0, -8, 0] }}
      transition={{
        duration: 7,
        repeat: Infinity,
        ease: 'easeInOut',
        repeatType: 'mirror',
      }}
    >
      {children}
    </motion.div>
  );
}

export function LandingAmbientGlow({ className }: { className?: string }) {
  const shouldReduceMotion = useReducedMotion();
  const isDesktop = useIsDesktopMotion();

  if (shouldReduceMotion || !isDesktop) {
    return null;
  }

  return (
    <motion.div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 -z-10 h-[min(70vh,40rem)] overflow-hidden',
        className,
      )}
    >
      <motion.div
        className="absolute top-[-20%] left-[15%] size-[28rem] rounded-full bg-primary/[0.04] blur-3xl"
        animate={{ x: [0, 36, 0], y: [0, 18, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror' }}
      />
      <motion.div
        className="absolute top-[10%] right-[10%] size-[22rem] rounded-full bg-brand-soft/30 blur-3xl"
        animate={{ x: [0, -28, 0], y: [0, 24, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror', delay: 2 }}
      />
    </motion.div>
  );
}

type EntranceProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
} & Omit<HTMLMotionProps<'div'>, 'children' | 'initial' | 'animate' | 'transition'>;

export function LandingEntrance({ children, className, delay = 0, ...rest }: EntranceProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: landingDuration.content, delay, ease: landingEase }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
