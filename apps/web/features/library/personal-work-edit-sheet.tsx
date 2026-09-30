'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@gloaming/i18n';
import type { LibraryItem } from '@gloaming/shared/library';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { formatLibraryApiError, libraryQueryKey, updatePersonalWork } from '@/features/library/library-api';

export function PersonalWorkEditSheet({
  entry,
  locale,
  open,
  onOpenChange,
}: {
  entry: LibraryItem;
  locale: Locale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(entry.work.title);
  const [author, setAuthor] = useState(entry.personalMetadata?.author ?? '');
  const [description, setDescription] = useState(entry.work.description);

  const mutation = useMutation({
    mutationFn: () => updatePersonalWork(entry.work.id, { title, author, description }),
    onSuccess: async () => {
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      toast.success(t(locale, 'content.library.bookInfoSaved'));
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 sm:max-w-md">
        <form
          className="flex min-h-full flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <SheetHeader className="pr-12">
            <SheetTitle>{t(locale, 'content.library.editBookTitle')}</SheetTitle>
            <SheetDescription>{entry.work.title}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 py-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span>{t(locale, 'content.library.bookTitle')}</span>
              <Input value={title} maxLength={200} required onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>{t(locale, 'content.library.bookAuthor')}</span>
              <Input value={author} maxLength={500} onChange={(event) => setAuthor(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>{t(locale, 'content.library.bookDescription')}</span>
              <Textarea
                value={description}
                maxLength={5000}
                rows={5}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
          <SheetFooter>
            <Button type="submit" disabled={mutation.isPending || title.trim().length === 0}>
              {t(locale, 'content.library.saveBookInfo')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
