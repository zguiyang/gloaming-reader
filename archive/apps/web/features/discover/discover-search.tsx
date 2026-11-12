'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import { type FormEvent } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
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
      <InputGroup className="h-10 flex-1 rounded-full">
        <InputGroupAddon className="pl-3">
          <SearchIcon strokeWidth={1.5} aria-hidden />
        </InputGroupAddon>
        <label htmlFor="discover-search" className="sr-only">
          {t(locale, 'content.discover.searchLabel')}
        </label>
        <InputGroupInput
          id="discover-search"
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t(locale, 'content.discover.searchPlaceholder')}
          className="h-10 px-1 [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-xs"
              onClick={onClear}
              aria-label={t(locale, 'content.discover.clearSearch')}
              className="rounded-full text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" strokeWidth={1.5} aria-hidden />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <Button type="submit" variant="outline" className="h-10 shrink-0 rounded-full px-4">
        {t(locale, 'content.discover.searchAction')}
      </Button>
    </form>
  );
}
