'use client';

import type { DiscoverItem } from '@/features/discover/discover-model';
import { DiscoverSourceCard } from '@/features/discover/discover-source-card';

type DiscoverGridProps = {
  items: DiscoverItem[];
};

export function DiscoverGrid({ items }: DiscoverGridProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4 md:gap-x-8 md:gap-y-12 lg:grid-cols-5">
      {items.map((item) => (
        <DiscoverSourceCard key={item.id} item={item} />
      ))}
    </div>
  );
}
