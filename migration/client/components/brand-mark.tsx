import Link from 'next/link';

import { APP_NAME } from '@/constants';
import { cn } from '@/lib/utils';

type BrandMarkProps = {
  href?: string;
  subtitle?: string;
  size?: 'sm' | 'md';
  className?: string;
  /** Hide the wordmark; keep the icon as the brand identifier. */
  wordmark?: boolean;
  /** Localized home link label for assistive tech (e.g. nav.brandHomeAria). */
  ariaLabel: string;
  /**
   * Visible wordmark text. Defaults to APP_NAME.
   * Site chrome uses the public product name "Gloaming".
   */
  name?: string;
  /**
   * `editorial` — mark + serif primary lockup for the shared site nav.
   * `default` — mark + UI wordmark for auth / admin chrome.
   */
  appearance?: 'default' | 'editorial';
};

export function BrandMark({
  href = '/',
  subtitle,
  size = 'sm',
  className,
  wordmark = true,
  ariaLabel,
  name = APP_NAME,
  appearance = 'default',
}: BrandMarkProps) {
  const isEditorial = appearance === 'editorial';
  const markClass = isEditorial
    ? size === 'md'
      ? 'h-8 w-auto'
      : 'h-7 w-auto'
    : size === 'md'
      ? 'h-10 w-auto'
      : 'h-8 w-auto';
  const titleClass = isEditorial
    ? size === 'md'
      ? 'font-heading text-[1.75rem] leading-none font-extrabold tracking-tight text-primary md:text-[28px]'
      : 'font-heading text-2xl leading-none font-extrabold tracking-tight text-primary'
    : size === 'md'
      ? 'text-xl font-semibold tracking-tight text-foreground'
      : 'text-lg font-semibold tracking-tight text-foreground';

  const content = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- local static mark; keep intrinsic ratio */}
      <img
        src="/gloaming-mark.png"
        alt=""
        width={32}
        height={27}
        className={cn(markClass, 'shrink-0')}
        decoding="async"
      />
      {wordmark ? (
        subtitle ? (
          <span className="flex flex-col">
            <span className={titleClass}>{name}</span>
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          </span>
        ) : (
          <span className={titleClass}>{name}</span>
        )
      ) : (
        <span className="sr-only">{name}</span>
      )}
    </>
  );

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center transition-opacity duration-300 ease-out-soft hover:opacity-90',
        isEditorial ? 'gap-2.5' : 'gap-3',
        !wordmark && 'gap-0',
        className,
      )}
      aria-label={ariaLabel}
    >
      {content}
    </Link>
  );
}
