'use client';

import { SlidersHorizontalIcon } from 'lucide-react';
import { useState } from 'react';

import { type Locale, t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DISCOVER_ALL_TAG, type DiscoverTagFilter } from '@/features/discover/discover-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type DiscoverFiltersProps = {
  tag: DiscoverTagFilter;
  tags: string[];
  onTagChange: (value: DiscoverTagFilter) => void;
};

function tagDisplayLabel(option: DiscoverTagFilter, locale: Locale): string {
  if (option === DISCOVER_ALL_TAG) {
    return t(locale, 'content.discover.allTags');
  }
  return option;
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors duration-200 ease-out-soft',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        active
          ? 'bg-primary font-medium text-primary-foreground'
          : 'border border-border bg-transparent text-muted-foreground hover:bg-surface-container-high md:border-0 md:bg-surface-container',
      )}
    >
      {label}
    </button>
  );
}

function tagOptions(catalogTags: string[]): DiscoverTagFilter[] {
  return [DISCOVER_ALL_TAG, ...catalogTags];
}

function MobileTuneSheet({ tag, tags, onTagChange }: DiscoverFiltersProps) {
  const { locale } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const options = tagOptions(tags);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="h-9 gap-2 rounded-full border-border/60 bg-card md:hidden">
            <SlidersHorizontalIcon className="size-4" strokeWidth={1.5} aria-hidden />
            {t(locale, 'content.discover.filter')}
          </Button>
        }
      />
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t(locale, 'content.discover.filterSheetTitle')}</SheetTitle>
          <SheetDescription>{t(locale, 'content.discover.filterSheetDescription')}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 flex flex-wrap gap-2">
          {options.map((option) => (
            <Chip
              key={option}
              label={tagDisplayLabel(option, locale)}
              active={tag === option}
              onClick={() => {
                onTagChange(option);
                setIsOpen(false);
              }}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DiscoverFilters({ tag, tags, onTagChange }: DiscoverFiltersProps) {
  const { locale } = useLocale();
  const options = tagOptions(tags);

  return (
    <div className="mb-8 flex items-center justify-between gap-4 md:mb-10">
      <div className="hidden flex-wrap gap-2 md:flex">
        {options.map((option) => (
          <Chip
            key={option}
            label={tagDisplayLabel(option, locale)}
            active={tag === option}
            onClick={() => onTagChange(option)}
          />
        ))}
      </div>
      <MobileTuneSheet tag={tag} tags={tags} onTagChange={onTagChange} />
    </div>
  );
}
