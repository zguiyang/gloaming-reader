'use client';

import { Skeleton } from '@/components/ui/skeleton';

const GRID_SKELETON_COUNT = 6;

export function LibrarySkeleton() {
  return (
    <div className="flex w-full gap-8 lg:gap-10" aria-hidden>
      <div className="hidden w-56 shrink-0 flex-col gap-2 md:flex">
        <Skeleton className="mb-1 h-3.5 w-14" />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={`source-${index}`} className="h-8 w-full rounded-lg" />
        ))}
        <Skeleton className="mt-5 mb-1 h-3.5 w-20" />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={`tag-${index}`} className="h-8 w-full rounded-lg" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <Skeleton className="h-20 w-full max-w-2xl rounded-xl" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: GRID_SKELETON_COUNT }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="aspect-[2/3] w-full rounded-sm" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
