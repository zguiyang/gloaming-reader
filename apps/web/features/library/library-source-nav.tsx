'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, Settings2Icon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { UserTagManagementItem } from '@gloaming/shared/library';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AUTH_ROUTES } from '@/constants';
import {
  completeUserTagTranslations,
  createUserTag,
  formatLibraryApiError,
  libraryQueryKey,
} from '@/features/library/library-api';
import {
  isLibraryFilterActive,
  libraryFilterHref,
  type LibraryFilters,
  type LibrarySource,
} from '@/features/library/library-filters';
import { LibraryTagFilter } from '@/features/library/library-tag-filter';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const SOURCE_OPTIONS = [
  ['all', 'content.library.allBooks'],
  ['personal', 'content.library.sourcePersonal'],
  ['saved', 'content.library.sourceSaved'],
] as const;

type LibrarySourceNavContentProps = {
  filters: LibraryFilters;
  tags: UserTagManagementItem[];
  tagsLoading: boolean;
  onSelectSource: (source: LibrarySource) => void;
  onSelectTag: (tagId: string | null) => void;
};

function LibrarySourceNavContent({
  filters,
  tags,
  tagsLoading,
  onSelectSource,
  onSelectTag,
}: LibrarySourceNavContentProps) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Carry the current Library filters into tag management so returning keeps the same view.
  const manageHref = isLibraryFilterActive(filters)
    ? `${AUTH_ROUTES.library}/tags?${new URLSearchParams({ returnTo: libraryFilterHref(filters) }).toString()}`
    : `${AUTH_ROUTES.library}/tags`;

  const submitNewTag = async () => {
    const name = newTagName.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    try {
      const tag = await createUserTag(name, locale);
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.tags });
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      setNewTagName('');
      setIsCreating(false);
      toast.success(t(locale, 'content.library.tagCreated'));
      void completeUserTagTranslations(tag.id)
        .then(async (result) => {
          await queryClient.invalidateQueries({ queryKey: libraryQueryKey.tags });
          await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
          toast.info(
            t(
              locale,
              result.status === 'completed'
                ? 'content.library.tagTranslationsComplete'
                : result.status === 'provider_unavailable'
                  ? 'content.library.tagTranslationProviderUnavailable'
                  : 'content.library.tagTranslationsMissing',
            ),
          );
        })
        .catch(() => toast.info(t(locale, 'content.library.tagTranslationsMissing')));
    } catch (error) {
      toast.error(formatLibraryApiError(error));
    } finally {
      setIsSaving(false);
    }
  };

  const rowClassName = (isActive: boolean) =>
    cn(
      'flex min-h-9 w-full items-center rounded-lg px-3 text-left text-sm transition-colors duration-200 ease-out-soft focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
      isActive
        ? 'bg-accent font-medium text-accent-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    );

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t(locale, 'content.library.sourceFilterAria')}>
        <h2 className="mb-2 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t(locale, 'content.library.sourceGroupLabel')}
        </h2>
        <ul className="flex flex-col gap-0.5">
          {SOURCE_OPTIONS.map(([source, label]) => {
            const isActive = filters.source === source;
            return (
              <li key={source}>
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  className={rowClassName(isActive)}
                  onClick={() => onSelectSource(source)}
                >
                  {t(locale, label)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>
        <div className="mb-2 flex items-center justify-between px-3">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t(locale, 'content.library.tagGroupLabel')}
          </h2>
          <Link
            href={manageHref}
            aria-label={t(locale, 'content.library.manageTags')}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Settings2Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{t(locale, 'content.library.manageTags')}</span>
          </Link>
        </div>

        {tagsLoading ? (
          <div className="flex flex-col gap-1 px-1" aria-hidden>
            <div className="h-8 animate-pulse rounded-lg bg-muted/60" />
            <div className="h-8 animate-pulse rounded-lg bg-muted/60" />
          </div>
        ) : tags.length === 0 ? null : (
          <nav aria-label={t(locale, 'content.library.tagFilterAria')}>
            <LibraryTagFilter tags={tags} selectedTagId={filters.tagId} onSelect={onSelectTag} />
          </nav>
        )}

        <div className="mt-2">
          {isCreating ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitNewTag();
              }}
            >
              <Input
                autoFocus
                value={newTagName}
                maxLength={80}
                disabled={isSaving}
                onChange={(event) => setNewTagName(event.currentTarget.value)}
                placeholder={t(locale, 'content.library.newTag')}
                aria-label={t(locale, 'content.library.tagName')}
                className="h-9"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="flex-1" disabled={!newTagName.trim() || isSaving}>
                  <CheckIcon className="size-3.5" aria-hidden />
                  {t(locale, 'content.library.createTag')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isSaving}
                  onClick={() => {
                    setIsCreating(false);
                    setNewTagName('');
                  }}
                >
                  {t(locale, 'content.library.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <button type="button" className={rowClassName(false)} onClick={() => setIsCreating(true)}>
              <PlusIcon className="size-3.5 shrink-0" aria-hidden />
              {t(locale, 'content.library.newTag')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LibrarySourceNav(props: LibrarySourceNavContentProps) {
  return (
    <aside className="hidden w-56 shrink-0 md:block">
      <LibrarySourceNavContent {...props} />
    </aside>
  );
}

export function LibraryMobileSourceNav({
  currentLabel,
  ...props
}: LibrarySourceNavContentProps & { currentLabel: string }) {
  const { locale } = useLocale();
  const [isOpen, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetTrigger
          render={<Button variant="outline" className="h-11 w-full justify-between rounded-xl px-4 text-sm" />}
        >
          <span className="min-w-0 truncate">{currentLabel}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </SheetTrigger>
        <SheetContent side="left" className="w-[min(18rem,100vw)] gap-0 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t(locale, 'content.library.chooseCategoryTitle')}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <LibrarySourceNavContent
              {...props}
              onSelectSource={(source) => {
                props.onSelectSource(source);
                setOpen(false);
              }}
              onSelectTag={(tagId) => {
                props.onSelectTag(tagId);
                setOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
