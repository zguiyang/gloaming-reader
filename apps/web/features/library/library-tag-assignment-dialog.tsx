'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  assignUserTag,
  createUserTag,
  formatLibraryApiError,
  libraryQueryKey,
  unassignUserTag,
} from '@/features/library/library-api';
import { useLocale } from '@/lib/locale-context';

export function LibraryTagAssignmentDialog({
  entry,
  tags,
  open,
  onOpenChange,
}: {
  entry: LibraryItem;
  tags: UserTagManagementItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale } = useLocale();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl bg-card text-foreground shadow-card ring-1 ring-border/50 outline-none sm:max-w-md">
          <header className="flex items-start justify-between gap-4 border-b border-border/50 px-5 py-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-heading text-xl font-semibold tracking-tight">
                {t(locale, 'content.library.manageTagsForBook')}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 truncate text-sm text-muted-foreground">
                {entry.work.title}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              render={<Button type="button" variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" />}
              aria-label={t(locale, 'common.close')}
            >
              <XIcon aria-hidden />
            </DialogPrimitive.Close>
          </header>
          {open ? (
            <LibraryTagAssignmentContent key={entry.work.id} entry={entry} tags={tags} onOpenChange={onOpenChange} />
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LibraryTagAssignmentContent({
  entry,
  tags,
  onOpenChange,
}: {
  entry: LibraryItem;
  tags: UserTagManagementItem[];
  onOpenChange: (open: boolean) => void;
}) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>(entry.userTags.map((tag) => tag.id));
  const [newName, setNewName] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const current = new Set(entry.userTags.map((tag) => tag.id));
      const selected = new Set(selectedIds);
      await Promise.all([
        ...selectedIds.filter((id) => !current.has(id)).map((id) => assignUserTag(entry.work.id, id)),
        ...entry.userTags.filter((tag) => !selected.has(tag.id)).map((tag) => unassignUserTag(entry.work.id, tag.id)),
      ]);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.tags });
      toast.success(t(locale, 'content.library.tagsSaved'));
      onOpenChange(false);
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  const createAndAssign = useMutation({
    mutationFn: async () => {
      const tag = await createUserTag(newName);
      await assignUserTag(entry.work.id, tag.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.tags });
      toast.success(t(locale, 'content.library.tagCreated'));
      setNewName('');
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  const isPending = save.isPending || createAndAssign.isPending;

  return (
    <div className="flex flex-col gap-4 p-5">
      {tags.length > 0 ? (
        <div className="max-h-60 overflow-y-auto">
          {tags.map((tag) => (
            <label
              key={tag.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border/40 py-2 text-sm last:border-0"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                checked={selectedIds.includes(tag.id)}
                onChange={(event) => {
                  const isChecked = event.currentTarget.checked;
                  setSelectedIds((current) =>
                    isChecked ? [...current, tag.id] : current.filter((selectedId) => selectedId !== tag.id),
                  );
                }}
              />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="text-xs text-muted-foreground">{tag.bookCount}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t(locale, 'content.library.noTags')}</p>
      )}

      <form
        className="flex items-center gap-2 border-t border-border/50 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim()) createAndAssign.mutate();
        }}
      >
        <Input
          value={newName}
          maxLength={80}
          onChange={(event) => setNewName(event.currentTarget.value)}
          placeholder={t(locale, 'content.library.newTag')}
          aria-label={t(locale, 'content.library.tagName')}
          disabled={isPending}
        />
        <Button
          type="submit"
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          disabled={!newName.trim() || isPending}
          aria-label={t(locale, 'content.library.createTag')}
        >
          <PlusIcon aria-hidden />
        </Button>
      </form>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogPrimitive.Close render={<Button variant="ghost" disabled={isPending} />}>
          {t(locale, 'common.close')}
        </DialogPrimitive.Close>
        <Button disabled={isPending} onClick={() => save.mutate()}>
          {t(locale, 'content.library.saveTags')}
        </Button>
      </div>
    </div>
  );
}
