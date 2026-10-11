'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import { type FormEvent } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/lib/locale-context';

type DiscoverSearchProps = {
  /** Current input draft; the applied query may differ until submit. */
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
};

/** Explicit Discover search: typing alone never fetches; submit or clear applies it. */
export function DiscoverSearch({ value, onValueChange, onSubmit, onClear }: DiscoverSearchProps) {
  const { locale } = useLocale();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form role="search" className="flex w-full items-center gap-2" onSubmit={handleSubmit}>
      <div className="relative flex-1">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        <label htmlFor="discover-search" className="sr-only">
          {t(locale, 'content.discover.searchLabel')}
        </label>
        <Input
          id="discover-search"
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t(locale, 'content.discover.searchPlaceholder')}
          className="h-10 rounded-full pr-9 pl-9"
        />
        {value ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={t(locale, 'content.discover.clearSearch')}
            className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <XIcon className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        ) : null}
      </div>
      <Button type="submit" variant="outline" className="h-10 shrink-0 rounded-full px-4">
        {t(locale, 'content.discover.searchAction')}
      </Button>
    </form>
  );
}
