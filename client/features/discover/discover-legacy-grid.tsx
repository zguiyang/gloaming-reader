'use client';

import { DiscoverBookCard } from '@/features/discover/discover-book-card';
import type { DiscoverLegacyWork } from '@/features/discover/discover-model';

type DiscoverLegacyGridProps = {
  items: DiscoverLegacyWork[];
};

/** Grid of compatibility cards for published Catalog Works without a SourceRecord. */
export function DiscoverLegacyGrid({ items }: DiscoverLegacyGridProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4 md:gap-x-8 md:gap-y-12 lg:grid-cols-5">
      {items.map((item) => (
        <DiscoverBookCard key={item.id} item={item} />
      ))}
    </div>
  );
}
