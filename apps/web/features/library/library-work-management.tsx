'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontalIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@gloaming/i18n';
import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  deletePersonalWork,
  formatLibraryApiError,
  libraryQueryKey,
  removeFromLibrary,
} from '@/features/library/library-api';
import { LibraryTagAssignmentDialog } from '@/features/library/library-tag-assignment-dialog';
import { PersonalWorkEditSheet } from '@/features/library/personal-work-edit-sheet';

export function LibraryWorkManagement({
  entry,
  tags,
  locale,
  onRemoved,
}: {
  entry: LibraryItem;
  tags: UserTagManagementItem[];
  locale: Locale;
  onRemoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [isRemoveConfirmationOpen, setIsRemoveConfirmationOpen] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [isEditSheetOpen, setIsEditSheetOpen] = useState(false);
  const isPersonal = entry.libraryItemKind === 'personal';

  const refreshLibrary = async () => {
    await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
    await queryClient.invalidateQueries({ queryKey: libraryQueryKey.tags });
    await queryClient.invalidateQueries({ queryKey: ['book-detail', entry.work.id] });
  };

  const removal = useMutation({
    mutationFn: () => removeFromLibrary(entry.work.id),
    onSuccess: async () => {
      setIsRemoveConfirmationOpen(false);
      await refreshLibrary();
      toast.success(t(locale, 'content.library.removedFromLibrary'));
      onRemoved?.();
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });
  const deletion = useMutation({
    mutationFn: () => deletePersonalWork(entry.work.id),
    onSuccess: async () => {
      setIsDeleteConfirmationOpen(false);
      await refreshLibrary();
      toast.success(t(locale, 'content.library.bookDeleted'));
      onRemoved?.();
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  const canManage = entry.canRemoveFromLibrary || (isPersonal && entry.availability !== 'processing');
  if (!canManage) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label={t(locale, 'content.library.manageBookAria', { title: entry.work.title })}
            />
          }
        >
          <MoreHorizontalIcon className="size-5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          {entry.availability === 'ready' ? (
            <DropdownMenuItem onClick={() => setIsTagDialogOpen(true)}>
              {t(locale, 'content.library.manageTagsForBook')}
            </DropdownMenuItem>
          ) : null}
          {isPersonal && entry.availability === 'ready' ? (
            <DropdownMenuItem onClick={() => setIsEditSheetOpen(true)}>
              {t(locale, 'content.library.editBookInfo')}
            </DropdownMenuItem>
          ) : null}
          {isPersonal ? (
            <DropdownMenuItem onClick={() => setIsDeleteConfirmationOpen(true)}>
              {t(locale, 'content.library.deleteBook')}
            </DropdownMenuItem>
          ) : null}
          {entry.canRemoveFromLibrary ? (
            <DropdownMenuItem onClick={() => setIsRemoveConfirmationOpen(true)}>
              {t(locale, 'content.library.removeFromLibrary')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isRemoveConfirmationOpen} onOpenChange={setIsRemoveConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(locale, 'content.library.removeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t(locale, 'content.library.removeConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removal.isPending}>{t(locale, 'common.close')}</AlertDialogCancel>
            <AlertDialogAction disabled={removal.isPending} onClick={() => removal.mutate()}>
              {t(locale, 'content.library.removeFromLibrary')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isDeleteConfirmationOpen} onOpenChange={setIsDeleteConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(locale, 'content.library.deleteBookConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(locale, 'content.library.deleteBookConfirmDescription', { title: entry.work.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletion.isPending}>{t(locale, 'common.close')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletion.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletion.mutate()}
            >
              {t(locale, 'content.library.deleteBook')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {entry.availability === 'ready' ? (
        <LibraryTagAssignmentDialog
          entry={entry}
          tags={tags}
          open={isTagDialogOpen}
          onOpenChange={setIsTagDialogOpen}
        />
      ) : null}
      {isPersonal && entry.availability === 'ready' && isEditSheetOpen ? (
        <PersonalWorkEditSheet entry={entry} locale={locale} open onOpenChange={setIsEditSheetOpen} />
      ) : null}
    </>
  );
}
