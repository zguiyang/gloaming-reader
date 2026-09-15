'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { t } from '@gloaming/i18n';

import { BrandMark } from '@/components/brand-mark';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type AuthLayoutProps = {
  children: ReactNode;
};

export function AuthLayout({ children }: AuthLayoutProps) {
  const { locale } = useLocale();

  return (
    <div className="relative z-10 flex min-h-full flex-1 flex-col">
      <header className="pt-7">
        <div className="container flex items-center justify-between">
          <BrandMark ariaLabel={t(locale, 'nav.brandHomeAria')} />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-14 md:py-20">
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:ease-out w-full max-w-[26rem]">
          {children}
        </div>
      </main>
    </div>
  );
}

type AuthIntroProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  className?: string;
};

export function AuthIntro({ eyebrow, title, description, className }: AuthIntroProps) {
  return (
    <div className={cn('mb-10 text-center md:text-left', className)}>
      {eyebrow ? <p className="mb-4 text-sm font-medium tracking-[0.16em] text-primary uppercase">{eyebrow}</p> : null}
      <h1 className="font-heading text-3xl leading-tight font-bold tracking-tight md:text-4xl">{title}</h1>
      {description ? <p className="mt-4 leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  );
}

type AuthPanelProps = {
  children: ReactNode;
  className?: string;
  /** `plain` for dialog embedding — no nested card chrome. */
  variant?: 'card' | 'plain';
};

export function AuthPanel({ children, className, variant = 'card' }: AuthPanelProps) {
  return (
    <div
      className={cn(
        variant === 'card' && 'rounded-3xl bg-card p-7 shadow-card ring-1 ring-foreground/5 md:p-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

type AuthFooterLinkProps = {
  prompt?: string;
  href: string;
  label: string;
};

export function AuthFooterLink({ prompt, href, label }: AuthFooterLinkProps) {
  return (
    <p className="mt-8 text-center text-sm text-muted-foreground">
      {prompt ? `${prompt} ` : null}
      <Link
        href={href}
        className="font-medium text-foreground transition-colors duration-300 ease-out-soft hover:text-primary"
      >
        {label}
      </Link>
    </p>
  );
}

type AuthFooterActionProps = {
  prompt?: string;
  label: string;
  onClick: () => void;
  className?: string;
};

export function AuthFooterAction({ prompt, label, onClick, className }: AuthFooterActionProps) {
  return (
    <p className={cn('mt-8 text-center text-sm text-muted-foreground', className)}>
      {prompt ? `${prompt} ` : null}
      <button
        type="button"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={onClick}
      >
        {label}
      </button>
    </p>
  );
}
