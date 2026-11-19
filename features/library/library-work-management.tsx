'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVerticalIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@/i18n';
import type { LibraryItem, UserTagManagementItem } from '@/shared/library';

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
import { PersonalWorkEditDialog } from '@/features/library/personal-work-edit-dialog';
import { cn } from '@/lib/utils';

export function LibraryWorkManagement({
  entry,
  tags,
  locale,
  onRemoved,
  detailHref,
}: {
  entry: LibraryItem;
  tags: UserTagManagementItem[];
  locale: Locale;
  onRemoved?: () => void;
  /** When set, expose “View details” in the menu (library cards). Omit on the detail page itself. */
  detailHref?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isRemoveConfirmationOpen, setIsRemoveConfirmationOpen] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
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

  const canManageTags = entry.availability === 'ready';
  const canEdit = isPersonal && entry.availability === 'ready';
  const canDelete = isPersonal;
  const canRemove = entry.canRemoveFromLibrary;
  const hasMenuItems = Boolean(detailHref) || canManageTags || canEdit || canDelete || canRemove;
  if (!hasMenuItems) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                // Visual size tracks one title line; expanded hit target keeps ≥44px tap.
                'relative -mt-0.5 shrink-0 text-muted-foreground hover:text-foreground',
                'after:absolute after:-inset-2 after:content-[""]',
              )}
              aria-label={t(locale, 'content.library.manageBookAria', { title: entry.work.title })}
            />
          }
        >
          <MoreVerticalIcon className="size-4" strokeWidth={1.75} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          {detailHref ? (
            <DropdownMenuItem onClick={() => router.push(detailHref)}>
              {t(locale, 'content.library.viewBookDetail')}
            </DropdownMenuItem>
          ) : null}
          {canManageTags ? (
            <DropdownMenuItem onClick={() => setIsTagDialogOpen(true)}>
              {t(locale, 'content.library.manageTagsForBook')}
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
              {t(locale, 'content.library.editBookInfo')}
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem onClick={() => setIsDeleteConfirmationOpen(true)}>
              {t(locale, 'content.library.deleteBook')}
            </DropdownMenuItem>
          ) : null}
          {canRemove ? (
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
      {canManageTags ? (
        <LibraryTagAssignmentDialog
          entry={entry}
          tags={tags}
          open={isTagDialogOpen}
          onOpenChange={setIsTagDialogOpen}
        />
      ) : null}
      {canEdit ? (
        <PersonalWorkEditDialog
          entry={entry}
          locale={locale}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
        />
      ) : null}
    </>
  );
}
