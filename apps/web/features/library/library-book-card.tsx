'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontalIcon } from 'lucide-react';
import Link from 'next/link';
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
import { AUTH_ROUTES } from '@/constants';
import {
  deletePersonalWork,
  formatLibraryApiError,
  libraryQueryKey,
  removeFromLibrary,
} from '@/features/library/library-api';
import { LibraryTagAssignmentDialog } from '@/features/library/library-tag-assignment-dialog';
import { PersonalWorkEditSheet } from '@/features/library/personal-work-edit-sheet';
import { WorkCover } from '@/features/work-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function statusLabel(entry: LibraryItem, locale: Locale): string {
  if (entry.availability === 'processing') {
    return t(locale, 'content.library.processing');
  }
  if (entry.availability === 'failed') {
    return t(locale, 'content.library.importFailed');
  }
  if (!entry.state) {
    return t(locale, 'content.library.statusNotStarted');
  }
  if (entry.state.status === 'completed') {
    return t(locale, 'content.library.statusCompleted');
  }
  if (entry.state.progressRatio <= 0) {
    return t(locale, 'content.library.statusNotStarted');
  }
  return t(locale, 'content.library.statusReadProgress', { ratio: entry.state.progressRatio });
}

export function LibraryBookCard({ entry, tags }: { entry: LibraryItem; tags: UserTagManagementItem[] }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [isRemoveConfirmationOpen, setIsRemoveConfirmationOpen] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [isEditSheetOpen, setIsEditSheetOpen] = useState(false);
  const { work, state } = entry;
  const readHref = AUTH_ROUTES.readBook(work.id, state?.currentPartId ?? undefined);
  const hasProgressBar = entry.availability === 'ready' && state?.status === 'in_progress' && state.progressRatio > 0;
  const coverImageUrl = coverUrlFromAssetId(work.coverAssetId);
  const removal = useMutation({
    mutationFn: () => removeFromLibrary(work.id),
    onSuccess: async () => {
      setIsRemoveConfirmationOpen(false);
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      toast.success(t(locale, 'content.library.removedFromLibrary'));
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });
  const deletion = useMutation({
    mutationFn: () => deletePersonalWork(work.id),
    onSuccess: async () => {
      setIsDeleteConfirmationOpen(false);
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      toast.success(t(locale, 'content.library.bookDeleted'));
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });
  const isPersonal = entry.libraryItemKind === 'personal';

  const cover = (
    <WorkCover
      title={work.title}
      coverImageUrl={coverImageUrl}
      className={cn('aspect-[2/3] rounded-sm', entry.availability !== 'ready' && 'grayscale-[0.25]')}
    />
  );

  return (
    <article className="group flex flex-col gap-3">
      {entry.availability === 'ready' ? (
        <Link
          href={readHref}
          className="outline-none transition-transform duration-300 ease-out-soft hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={t(locale, 'content.common.openReaderAria', { title: work.title })}
        >
          {cover}
        </Link>
      ) : (
        <div className="relative" aria-hidden="true">
          {cover}
          {entry.availability === 'processing' && !coverImageUrl ? (
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm" aria-hidden>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-background/25 to-transparent motion-safe:animate-[library-cover-sheen_4.5s_ease-in-out_infinite]" />
            </div>
          ) : null}
        </div>
      )}

      <div className="min-w-0">
        <div className="flex items-start gap-1">
          {entry.availability === 'ready' ? (
            <Link
              href={readHref}
              className="min-w-0 flex-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <h3
                className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground transition-colors duration-300 ease-out-soft group-hover:text-primary md:text-base"
                title={work.title}
              >
                {work.title}
              </h3>
            </Link>
          ) : (
            <h3 className="font-heading min-w-0 flex-1 line-clamp-2 text-sm leading-snug font-medium text-foreground md:text-base">
              {work.title}
            </h3>
          )}
          {entry.canRemoveFromLibrary || (isPersonal && entry.availability !== 'processing') ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mr-2 -mt-2 size-11 shrink-0 opacity-100 transition-opacity focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  />
                }
                aria-label={t(locale, 'content.library.manageBookAria', { title: work.title })}
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
          ) : null}
        </div>
        <p
          className={cn(
            'mt-1.5 text-xs',
            entry.availability === 'failed' ? 'text-destructive' : 'text-muted-foreground/90',
          )}
          role={entry.availability === 'processing' ? 'status' : undefined}
        >
          {statusLabel(entry, locale)}
        </p>
        {entry.availability === 'processing' ? (
          <div
            className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-muted/80"
            role="progressbar"
            aria-label={t(locale, 'content.library.processing')}
            aria-valuetext={t(locale, 'content.library.indeterminateProgress')}
          >
            <div className="h-full w-1/3 rounded-full bg-primary/70 motion-safe:animate-[library-indeterminate_2.4s_ease-in-out_infinite]" />
          </div>
        ) : null}
        {entry.availability === 'failed' ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(locale, 'content.library.failedHint')}
          </p>
        ) : null}
        {hasProgressBar ? (
          <div
            className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-muted/80"
            role="progressbar"
            aria-label={t(locale, 'content.library.statusReadProgress', { ratio: state.progressRatio })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, state.progressRatio)}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out-soft"
              style={{ width: `${Math.min(100, state.progressRatio)}%` }}
            />
          </div>
        ) : null}
      </div>

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
              {t(locale, 'content.library.deleteBookConfirmDescription', { title: work.title })}
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
      <LibraryTagAssignmentDialog entry={entry} tags={tags} open={isTagDialogOpen} onOpenChange={setIsTagDialogOpen} />
      {isPersonal && isEditSheetOpen ? (
        <PersonalWorkEditSheet entry={entry} locale={locale} open onOpenChange={setIsEditSheetOpen} />
      ) : null}
    </article>
  );
}
