'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon, CheckIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { UserTagManagementItem } from '@gloaming/shared/library';

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthDialog } from '@/features/auth';
import {
  createUserTag,
  deleteUserTag,
  formatLibraryApiError,
  libraryQueryKey,
  renameUserTag,
  useUserTagsQuery,
} from '@/features/library/library-api';
import { isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';

export function LibraryTagsPage() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const queryClient = useQueryClient();
  const tagsQuery = useUserTagsQuery();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingTag, setDeletingTag] = useState<UserTagManagementItem | null>(null);

  useEffect(() => {
    if (tagsQuery.isError && isUnauthorizedError(tagsQuery.error)) openLogin();
  }, [openLogin, tagsQuery.error, tagsQuery.isError]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: libraryQueryKey.tags });
    await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
  };

  const create = useMutation({
    mutationFn: () => createUserTag(newName.trim()),
    onSuccess: async () => {
      setNewName('');
      await refresh();
      toast.success(t(locale, 'content.library.tagCreated'));
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  const rename = useMutation({
    mutationFn: () => renameUserTag(editingId!, editingName.trim()),
    onSuccess: async () => {
      setEditingId(null);
      setEditingName('');
      await refresh();
      toast.success(t(locale, 'content.library.tagRenamed'));
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
  const isPending = create.isPending || rename.isPending || remove.isPending;

  return (
    <main className="mx-auto w-full max-w-3xl">
      <Link
        href="/library"
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        {t(locale, 'content.library.title')}
      </Link>
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          {t(locale, 'content.library.tagManagementTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t(locale, 'content.library.tagManagementDescription')}</p>
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
          {tags.map((tag) => (
            <li key={tag.id} className="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-5">
              {editingId === tag.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (editingName.trim()) rename.mutate();
                  }}
                >
                  <Input
                    autoFocus
                    value={editingName}
                    maxLength={80}
                    onChange={(event) => setEditingName(event.currentTarget.value)}
                    aria-label={t(locale, 'content.library.tagName')}
                    disabled={isPending}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={t(locale, 'content.library.save')}
                    disabled={!editingName.trim() || isPending}
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
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t(locale, 'content.library.usedInBooks', { count: tag.bookCount })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`${t(locale, 'content.library.renameTag')}: ${tag.name}`}
                    disabled={isPending}
                    onClick={() => {
                      setEditingId(tag.id);
                      setEditingName(tag.name);
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
          ))}
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
