'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon, CheckIcon, LanguagesIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { SUPPORTED_LOCALES, t } from '@gloaming/i18n';
import { isUserTagTranslationMissing, resolveUserTagName, type UserTagManagementItem } from '@gloaming/shared/library';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import {
  completeUserTagTranslations,
  createUserTag,
  deleteUserTag,
  formatLibraryApiError,
  libraryQueryKey,
  renameUserTag,
  useUserTagsQuery,
} from '@/features/library/library-api';
import {
  buildLibraryFilterQuery,
  parseLibraryFilters,
  resolveLibraryReturnTo,
} from '@/features/library/library-filters';
import { isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';

export function LibraryTagsPage() {
  return (
    <Suspense fallback={null}>
      <LibraryTagsPageContent />
    </Suspense>
  );
}

function LibraryTagsPageContent() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const queryClient = useQueryClient();
  const tagsQuery = useUserTagsQuery();
  const searchParams = useSearchParams();
  const returnTo = resolveLibraryReturnTo(searchParams?.get('returnTo') ?? undefined);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [deletingTag, setDeletingTag] = useState<UserTagManagementItem | null>(null);

  useEffect(() => {
    if (tagsQuery.isError && isUnauthorizedError(tagsQuery.error)) openLogin();
  }, [openLogin, tagsQuery.error, tagsQuery.isError]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: libraryQueryKey.tags });
    await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
    await queryClient.invalidateQueries({ queryKey: ['book-detail'] });
  };

  const create = useMutation({
    mutationFn: () => createUserTag(newName.trim(), locale),
    onSuccess: async (tag) => {
      setNewName('');
      await refresh();
      toast.success(t(locale, 'content.library.tagCreated'));
      void completeUserTagTranslations(tag.id)
        .then(async (result) => {
          await refresh();
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
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  const rename = useMutation({
    mutationFn: async () => {
      const tag = tags.find((item) => item.id === editingId);
      if (!tag) return;
      for (const language of SUPPORTED_LOCALES) {
        const name = editingNames[language]?.trim();
        if (name && name !== tag.localizedNames?.[language]) {
          await renameUserTag(tag.id, name, language);
        }
      }
    },
    onSuccess: async () => {
      setEditingId(null);
      setEditingNames({});
      await refresh();
      toast.success(t(locale, 'content.library.tagRenamed'));
    },
    // A later locale may fail after earlier ones persisted: refetch so the list matches
    // persistence, but keep the user in edit mode with their input retained.
    onError: async (error) => {
      await refresh();
      toast.error(formatLibraryApiError(error));
    },
  });

  const completeTranslations = useMutation({
    mutationFn: (tagId: string) => completeUserTagTranslations(tagId),
    onSuccess: async (result) => {
      await refresh();
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
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  const remove = useMutation({
    mutationFn: () => deleteUserTag(deletingTag!.id),
    onSuccess: async () => {
      setDeletingTag(null);
      await refresh();
      toast.success(t(locale, 'content.library.tagDeleted'));
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  const tags = tagsQuery.data ?? [];
  const isPending = create.isPending || rename.isPending || remove.isPending || completeTranslations.isPending;
  const tagHref = (tagId: string) => {
    const target = new URL(returnTo, 'https://gloaming.invalid');
    const filters = parseLibraryFilters(target.searchParams);
    const query = buildLibraryFilterQuery({ ...filters, tagId }, target.searchParams);
    return query ? `${AUTH_ROUTES.library}?${query}` : AUTH_ROUTES.library;
  };

  return (
    <main className="mx-auto w-full max-w-3xl">
      <Link
        href={returnTo}
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        {t(locale, 'content.library.title')}
      </Link>
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          {t(locale, 'content.library.tagManagementTitle')}
        </h1>
      </header>

      <form
        className="mb-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim()) create.mutate();
        }}
      >
        <Input
          value={newName}
          maxLength={80}
          onChange={(event) => setNewName(event.currentTarget.value)}
          placeholder={t(locale, 'content.library.newTag')}
          aria-label={t(locale, 'content.library.tagName')}
          disabled={isPending}
          className="h-11"
        />
        <Button type="submit" className="h-11 shrink-0 sm:min-w-36" disabled={!newName.trim() || isPending}>
          {t(locale, 'content.library.createTag')}
        </Button>
      </form>

      {tagsQuery.isPending ? (
        <div className="divide-y divide-border/50 rounded-xl border border-border/60" aria-busy="true">
          <div className="h-16 animate-pulse bg-muted/30" />
          <div className="h-16 animate-pulse bg-muted/30" />
        </div>
      ) : tagsQuery.isError ? (
        <p className="py-8 text-sm text-muted-foreground">{t(locale, 'content.library.loadFailed')}</p>
      ) : tags.length === 0 ? (
        <p className="rounded-xl border border-border/60 px-5 py-8 text-center text-sm text-muted-foreground">
          {t(locale, 'content.library.noTagsInLibrary')}
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
          {tags.map((tag) => {
            const hasInput = SUPPORTED_LOCALES.some((language) => (editingNames[language] ?? '').trim() !== '');
            const hasClearedName = SUPPORTED_LOCALES.some(
              (language) =>
                (editingNames[language] ?? '').trim() === '' && Boolean(tag.localizedNames?.[language]?.trim()),
            );
            return (
              <li key={tag.id} className="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-5">
                {editingId === tag.id ? (
                  <form
                    className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end"
                    onSubmit={(event) => {
                      event.preventDefault();
                      // Clearing an existing locale name is not an implicit skip: ask for a name explicitly.
                      if (hasClearedName) {
                        toast.error(t(locale, 'content.library.tagNameRequired'));
                        return;
                      }
                      if (hasInput) rename.mutate();
                    }}
                  >
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                      {SUPPORTED_LOCALES.map((language) => (
                        <label key={language} className="min-w-0 text-xs text-muted-foreground">
                          <span>{language}</span>
                          <Input
                            autoFocus={language === locale}
                            value={editingNames[language] ?? ''}
                            maxLength={80}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setEditingNames((current) => ({ ...current, [language]: value }));
                            }}
                            aria-label={`${t(locale, 'content.library.tagName')} (${language})`}
                            disabled={isPending}
                            className="mt-1 h-10 text-foreground"
                          />
                        </label>
                      ))}
                    </div>
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      aria-label={t(locale, 'content.library.save')}
                      disabled={isPending || (!hasInput && !hasClearedName)}
                    >
                      <CheckIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      aria-label={t(locale, 'content.library.cancel')}
                      disabled={isPending}
                      onClick={() => setEditingId(null)}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={tagHref(tag.id)}
                        className="flex min-h-8 items-center justify-between gap-3 rounded-md text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">
                            {resolveUserTagName(tag, locale)}
                          </span>
                          {tag.createdBy === 'ai' ? (
                            <Badge variant="secondary" className="shrink-0 rounded-full px-1.5 font-normal">
                              {t(locale, 'content.library.aiTagBadge')}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t(locale, 'content.library.usedInBooks', { count: tag.bookCount })}
                        </span>
                      </Link>
                      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {SUPPORTED_LOCALES.map((language) => (
                          <span key={language}>
                            {language}:{' '}
                            {tag.localizedNames?.[language] ?? t(locale, 'content.library.tagTranslationsMissing')}
                          </span>
                        ))}
                      </div>
                    </div>
                    {SUPPORTED_LOCALES.some((language) => isUserTagTranslationMissing(tag, language)) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0"
                        aria-label={`${t(locale, 'content.library.completeTagTranslations')}: ${tag.name}`}
                        disabled={isPending}
                        onClick={() => completeTranslations.mutate(tag.id)}
                      >
                        <LanguagesIcon aria-hidden />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      aria-label={`${t(locale, 'content.library.renameTag')}: ${tag.name}`}
                      disabled={isPending}
                      onClick={() => {
                        setEditingId(tag.id);
                        setEditingNames(
                          Object.fromEntries(
                            SUPPORTED_LOCALES.map((language) => [
                              language,
                              tag.localizedNames?.[language] ??
                                (language === locale && !tag.sourceLocale ? tag.name : ''),
                            ]),
                          ),
                        );
                      }}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`${t(locale, 'content.library.deleteTag')}: ${tag.name}`}
                      disabled={isPending}
                      onClick={() => setDeletingTag(tag)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={deletingTag !== null} onOpenChange={(open) => !open && setDeletingTag(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(locale, 'content.library.tagDeleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingTag && deletingTag.bookCount > 0
                ? t(locale, 'content.library.tagDeleteConfirmDescription', { count: deletingTag.bookCount })
                : t(locale, 'content.library.tagDeleteConfirmDescriptionEmpty')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{t(locale, 'content.library.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t(locale, 'content.library.deleteTag')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
