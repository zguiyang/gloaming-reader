'use client';

import { Skeleton } from '@/components/ui/skeleton';

const GRID_SKELETON_COUNT = 4;

export function LibrarySkeleton() {
  return (
    <div className="flex w-full flex-col gap-12 md:gap-16" aria-hidden>
      <div className="flex flex-col items-center gap-8 rounded-[1.75rem] border border-border/30 bg-paper p-6 md:flex-row md:gap-12 md:rounded-[2rem] md:p-10">
        <Skeleton className="aspect-[2/3] w-40 shrink-0 rounded-sm md:w-56" />
        <div className="flex w-full flex-1 flex-col items-center gap-4 md:items-start">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-10 w-3/4 max-w-md" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-4 h-1 w-full max-w-sm" />
          <Skeleton className="mt-4 h-12 w-full max-w-xs rounded-full md:w-40" />
        </div>
      </div>
      <div>
        <Skeleton className="mb-6 h-4 w-20" />
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4 md:gap-x-8 lg:grid-cols-5">
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
