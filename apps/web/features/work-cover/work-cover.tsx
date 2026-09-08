'use client';

import { useState } from 'react';

import { coverTintForVolume } from '@/features/work-cover/work-cover-tint';
import { cn } from '@/lib/utils';

export type WorkCoverAppearance = 'standard' | 'compact';

export type WorkCoverProps = {
  title: string;
  /** Used by `standard` tint seeding; ignored by `compact` (always empty tags). */
  tags?: string[];
  coverImageUrl?: string | null;
  /** Layout size overrides for `standard` only. Must not be used to fake `compact`. */
  className?: string;
  appearance?: WorkCoverAppearance;
};

export function WorkCover({ title, tags = [], coverImageUrl, className, appearance = 'standard' }: WorkCoverProps) {
  if (appearance === 'compact') {
    return <WorkCoverCompact title={title} coverImageUrl={coverImageUrl ?? null} />;
  }

  return <WorkCoverStandard title={title} tags={tags} coverImageUrl={coverImageUrl} className={className} />;
}

function WorkCoverStandard({
  title,
  tags,
  coverImageUrl,
  className,
}: {
  title: string;
  tags: string[];
  coverImageUrl?: string | null;
  className?: string;
}) {
  const tint = coverTintForVolume(tags, title);
  const [hasImageFailed, setHasImageFailed] = useState(false);
  const canShowImage = Boolean(coverImageUrl) && !hasImageFailed;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-l-md rounded-r-xl shadow-card ring-1 ring-foreground/8',
        'transition-transform duration-300 ease-out-soft motion-safe:hover:scale-[1.015]',
        !canShowImage && tint,
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1.5 bg-gradient-to-r from-foreground/15 to-transparent"
        aria-hidden
      />
      {canShowImage ? (
        // Asset URLs may be same-origin `/api/assets/:id` — plain img avoids next/image remote config.
        // eslint-disable-next-line @next/next/no-img-element -- cover assets served via API proxy
        <img
          src={coverImageUrl!}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-95"
          onError={() => setHasImageFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between p-4 md:p-5">
          <span className="self-end rounded-sm border border-border/30 bg-background/95 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-foreground shadow-sm">
            官方
          </span>
          <p className="font-heading line-clamp-5 text-base font-bold leading-snug text-foreground/85 md:text-xl">
            {title}
          </p>
        </div>
      )}
    </div>
  );
}

function WorkCoverCompact({ title, coverImageUrl }: { title: string; coverImageUrl: string | null }) {
  const tint = coverTintForVolume([], title);

  return (
    <div
      className={cn(
        'relative h-20 w-14 shrink-0 overflow-hidden rounded-sm shadow-sm ring-1 ring-foreground/8 md:h-24 md:w-16',
        !coverImageUrl && tint,
      )}
    >
      {coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- cover assets via API proxy
        <img src={coverImageUrl} alt="" className="size-full object-cover" />
      ) : (
        <p className="font-heading line-clamp-4 p-1.5 text-[10px] font-semibold leading-tight text-foreground/80 md:p-2 md:text-xs">
          {title}
        </p>
      )}
    </div>
  );
}
