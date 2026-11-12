'use client';

import type { ComponentProps } from 'react';

import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * Soft segmented control (muted track + raised active pill) on shadcn Tabs.
 * Height comes from padding so pills stay inside the track.
 */
export function AdminSegmentedTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      variant="default"
      className={cn('h-auto w-fit gap-1 rounded-xl bg-muted/80 p-1.5', 'group-data-horizontal/tabs:h-auto', className)}
      {...props}
    />
  );
}

export function AdminSegmentedTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        'h-auto min-h-0 flex-none rounded-xl px-5 py-2.5 text-sm font-medium text-muted-foreground',
        'border border-transparent shadow-none',
        'transition-colors duration-300 ease-out-soft',
        'hover:text-foreground',
        'data-active:border-border/80 data-active:bg-card data-active:font-semibold data-active:text-foreground data-active:shadow-card',
        'after:hidden',
        className,
      )}
      {...props}
    />
  );
}
