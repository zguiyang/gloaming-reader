import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Bump when replacing `/public/landing/shot-*.webp` so browsers do not serve stale assets. */
export const LANDING_SHOT_ASSET_VERSION = '20261119-desktop-v4';

export function landingShotSrc(path: string) {
  return `${path}?v=${LANDING_SHOT_ASSET_VERSION}`;
}

/** Product frame: real screenshot when `src` is set; otherwise children mock. */
export function LandingShot({
  caption,
  children,
  className,
  lift = false,
  src,
  alt = '',
}: {
  caption?: string;
  children?: ReactNode;
  className?: string;
  lift?: boolean;
  /** Prefer `/landing/shot-*.webp` real captures. */
  src?: string;
  alt?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[18px] border border-outline-variant/80 bg-card',
        lift ? 'shadow-[0_8px_24px_-6px_rgba(60,40,30,0.06),0_2px_6px_-1px_rgba(60,40,30,0.03)]' : 'shadow-card',
        className,
      )}
    >
      {!src && caption ? (
        <div className="pointer-events-none absolute top-3 right-4 z-10">
          <span className="rounded bg-black/60 px-2 py-0.5 font-sans text-[11px] tracking-wide text-white">
            {caption}
          </span>
        </div>
      ) : null}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- full-frame marketing captures; natural dimensions
        <img
          src={landingShotSrc(src)}
          alt={alt}
          className="block h-auto w-full"
          decoding="async"
          fetchPriority={lift ? 'high' : undefined}
        />
      ) : (
        children
      )}
    </div>
  );
}
