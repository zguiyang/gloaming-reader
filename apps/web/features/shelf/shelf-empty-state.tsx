'use client';

import Link from 'next/link';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { useLocale } from '@/lib/locale-context';

function EmptyShelfIllustration() {
  return (
    <div
      className="flex size-40 items-center justify-center rounded-full bg-muted ring-1 ring-border/40 md:size-52"
      aria-hidden
    >
      <svg
        viewBox="0 0 120 96"
        className="h-20 w-24 text-primary/80 md:h-24 md:w-28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M18 22c14 8 28 8 42 0v52c-14 8-28 8-42 0V22Z"
          className="fill-paper stroke-primary/35"
          strokeWidth="2"
        />
        <path
          d="M102 22c-14 8-28 8-42 0v52c14 8 28 8 42 0V22Z"
          className="fill-card stroke-primary/35"
          strokeWidth="2"
        />
        <path d="M60 22v52" className="stroke-brand-deep/40" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M34 40h12M34 50h16M78 40h12M74 50h16"
          className="stroke-muted-foreground/40"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function ShelfEmptyState() {
  const { locale } = useLocale();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-2 py-16 text-center md:py-24">
      <EmptyShelfIllustration />
      <h2 className="font-heading mt-10 text-2xl font-semibold tracking-tight text-foreground md:text-[2rem] md:leading-10">
        {t(locale, 'content.shelf.emptyTitle')}
      </h2>
      <p className="mt-4 max-w-sm text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
        {t(locale, 'content.shelf.emptyDescription')}
      </p>
      <Button
        nativeButton={false}
        className="mt-10 h-12 rounded-full px-10 text-base hover:bg-brand-deep active:scale-[0.98]"
        render={<Link href={AUTH_ROUTES.discover} />}
      >
        {t(locale, 'content.common.findBookCta')}
      </Button>
    </div>
  );
}
