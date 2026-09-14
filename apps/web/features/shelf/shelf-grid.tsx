'use client';

import { t } from '@gloaming/i18n';
import type { ShelfItem } from '@gloaming/shared/shelf';

import { ShelfBookCard } from '@/features/shelf/shelf-book-card';
import { useLocale } from '@/lib/locale-context';

export function ShelfGrid({ items }: { items: ShelfItem[] }) {
  const { locale } = useLocale();

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="w-full">
      <div className="mb-6 flex items-center border-b border-border/40 pb-4 md:mb-8">
        <h3 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          {t(locale, 'content.shelf.myCollection')}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4 md:gap-x-8 md:gap-y-12 lg:grid-cols-5">
        {items.map((entry) => (
          <ShelfBookCard key={entry.work.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}
