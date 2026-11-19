'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@/i18n';
import type { LibraryItem } from '@/shared/library';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatLibraryApiError, libraryQueryKey, updatePersonalWork } from '@/features/library/library-api';

export function PersonalWorkEditDialog({
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <header className="flex items-start justify-between gap-4 border-b border-border/50 px-5 py-5">
          <DialogTitle className="font-heading text-xl font-semibold tracking-tight">
            {t(locale, 'content.library.editBookTitle')}
          </DialogTitle>
          <DialogClose
            render={<Button type="button" variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" />}
            aria-label={t(locale, 'common.close')}
          >
            <XIcon aria-hidden />
          </DialogClose>
        </header>
        {open ? (
          <PersonalWorkEditForm key={entry.work.id} entry={entry} locale={locale} onOpenChange={onOpenChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PersonalWorkEditForm({
  entry,
  locale,
  onOpenChange,
}: {
  entry: LibraryItem;
  locale: Locale;
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
      await queryClient.invalidateQueries({ queryKey: ['book-detail', entry.work.id] });
      toast.success(t(locale, 'content.library.bookInfoSaved'));
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
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
      <div className="flex flex-col-reverse gap-2 border-t border-border/50 pt-4 sm:flex-row sm:justify-end">
        <DialogClose render={<Button type="button" variant="ghost" disabled={mutation.isPending} />}>
          {t(locale, 'common.close')}
        </DialogClose>
        <Button type="submit" disabled={mutation.isPending || title.trim().length === 0}>
          {t(locale, 'content.library.saveBookInfo')}
        </Button>
      </div>
    </form>
  );
}
