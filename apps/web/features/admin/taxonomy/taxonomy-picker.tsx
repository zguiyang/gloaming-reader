'use client';

import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { t } from '@gloaming/i18n';
import type { TaxonomyItem } from '@gloaming/shared/taxonomy';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useTaxonomyQuery } from '@/features/admin/taxonomy/taxonomy-api';
import {
  filterTaxonomyPickerItems,
  resolveTaxonomyAuxiliaryName,
  resolveTaxonomyItemById,
  resolveTaxonomyPrimaryName,
} from '@/features/admin/taxonomy/taxonomy-format';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function TaxonomyOptionLabel({ item, locale }: { item: TaxonomyItem; locale: ReturnType<typeof useLocale>['locale'] }) {
  const primary = resolveTaxonomyPrimaryName(item.names, locale);
  const auxiliary = resolveTaxonomyAuxiliaryName(item.names, locale);

  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate">{primary}</span>
      {auxiliary ? <span className="block truncate text-xs text-muted-foreground">{auxiliary}</span> : null}
    </span>
  );
}

function OptionRow({
  item,
  selected,
  onSelect,
  locale,
}: {
  item: TaxonomyItem;
  selected: boolean;
  onSelect: () => void;
  locale: ReturnType<typeof useLocale>['locale'];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        selected ? 'bg-brand-soft text-brand-deep' : 'hover:bg-surface-container-high',
      )}
    >
      <TaxonomyOptionLabel item={item} locale={locale} />
      <span className="flex shrink-0 items-center gap-1.5">
        {item.usage > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t(locale, 'admin.taxonomy.picker.usageWorks', { count: item.usage })}
          </span>
        ) : null}
        {selected ? <Check className="size-4 shrink-0" /> : null}
      </span>
    </button>
  );
}

type MultiPickerProps = {
  kind: 'tag' | 'source';
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
};

/** Multi-select search picker for tags / sources — values are stable taxonomy ids. */
export function TaxonomyMultiPicker({ kind, value, onChange, placeholder, disabled }: MultiPickerProps) {
  const { locale } = useLocale();
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = useTaxonomyQuery(kind);
  const filteredItems = useMemo(() => filterTaxonomyPickerItems(query.data ?? [], search), [query.data, search]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        disabled={disabled}
        nativeButton={false}
        render={
          <div
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            tabIndex={disabled ? -1 : 0}
            className={cn(
              'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground shadow-xs outline-none',
              'focus-visible:ring-2 focus-visible:ring-brand/40',
              'data-[popup-open]:ring-2 data-[popup-open]:ring-brand/40',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          />
        }
      >
        {value.length > 0 ? (
          value.map((id) => {
            const item = resolveTaxonomyItemById(query.data ?? [], id);
            const label = item ? resolveTaxonomyPrimaryName(item.names, locale) : id;
            return (
              <Badge key={id} variant="secondary" className="gap-1 pr-1">
                {label}
                <button
                  type="button"
                  aria-label={t(locale, 'admin.taxonomy.picker.removeAria', { name: label })}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(id);
                  }}
                  className="rounded-full p-0.5 hover:bg-surface-container-high"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })
        ) : (
          <span className="px-1 text-muted-foreground">{placeholder ?? t(locale, 'admin.content.common.select')}</span>
        )}
        <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t(locale, 'admin.content.common.searchExisting')}
          className="mb-1.5"
        />
        <div id={listboxId} className="max-h-64 overflow-y-auto">
          {query.isPending ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : filteredItems.length > 0 ? (
            <ul role="listbox" className="flex flex-col gap-0.5">
              {filteredItems.map((item) => (
                <li key={item.id} role="option" aria-selected={value.includes(item.id)}>
                  <OptionRow
                    item={item}
                    selected={value.includes(item.id)}
                    onSelect={() => toggle(item.id)}
                    locale={locale}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              {search ? t(locale, 'admin.content.common.noMatch') : t(locale, 'admin.content.common.noData')}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SelectProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show a 「不分类」 clear entry. */
  allowClear?: boolean;
};

/** Single-select search picker for the work category — value is a stable taxonomy id. */
export function TaxonomySelect({ value, onChange, placeholder, disabled, allowClear }: SelectProps) {
  const { locale } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = useTaxonomyQuery('category');
  const filteredItems = useMemo(() => filterTaxonomyPickerItems(query.data ?? [], search), [query.data, search]);
  const selectedItem = value ? resolveTaxonomyItemById(query.data ?? [], value) : undefined;
  const selectedLabel = selectedItem ? resolveTaxonomyPrimaryName(selectedItem.names, locale) : null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-haspopup="listbox"
            className={cn(
              'flex min-h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none',
              'focus-visible:ring-2 focus-visible:ring-brand/40',
              'data-[popup-open]:ring-2 data-[popup-open]:ring-brand/40',
              !selectedLabel && 'text-muted-foreground',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedLabel ?? placeholder ?? t(locale, 'admin.works.metadata.categoryPlaceholder')}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t(locale, 'admin.taxonomy.picker.searchCategory')}
          className="mb-1.5"
        />
        <div className="max-h-64 overflow-y-auto">
          {allowClear ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-container-high',
                !value && 'text-brand-deep',
              )}
            >
              <span>{t(locale, 'admin.taxonomy.picker.noCategory')}</span>
              {!value ? <Check className="size-4" /> : null}
            </button>
          ) : null}
          {query.isPending ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : filteredItems.length > 0 ? (
            <ul role="listbox" className="flex flex-col gap-0.5">
              {filteredItems.map((item) => (
                <li key={item.id} role="option" aria-selected={value === item.id}>
                  <OptionRow
                    item={item}
                    selected={value === item.id}
                    onSelect={() => {
                      onChange(item.id);
                      setIsOpen(false);
                    }}
                    locale={locale}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              {search ? t(locale, 'admin.content.common.noMatch') : t(locale, 'admin.taxonomy.picker.noCategories')}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
