'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUpIcon } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@/i18n';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  formatLibraryApiError,
  libraryQueryKey,
  personalEpubValidationError,
  uploadPersonalEpub,
} from '@/features/library/library-api';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

/** Empty shelf CTA: pick/drop an EPUB and upload in place (nav still uses the dialog). */
export function LibraryEmptyState() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: uploadPersonalEpub,
    onSuccess: async () => {
      toast.success(t(locale, 'content.library.uploadStarted'));
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  function beginUpload(file?: File) {
    if (!file || uploadMutation.isPending) return;
    const error = personalEpubValidationError(file);
    if (error) {
      toast.error(t(locale, error === 'format' ? 'content.library.invalidEpub' : 'content.library.epubTooLarge'));
      return;
    }
    uploadMutation.mutate(file);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    beginUpload(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  const pending = uploadMutation.isPending;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-1 pb-10 pt-2 text-center md:pt-8">
      <h2 className="font-heading mb-6 text-xl font-medium tracking-tight text-foreground md:mb-8 md:text-2xl">
        {t(locale, 'content.library.emptyTitle')}
      </h2>
      <Button
        variant="plain"
        size={null}
        type="button"
        disabled={pending}
        className={cn(
          'group flex min-h-56 w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-9 transition-colors md:min-h-64',
          'border-border/80 bg-card/45 hover:border-primary/45 hover:bg-paper/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          isDragging && 'border-primary/65 bg-paper/75',
          pending && 'pointer-events-none opacity-90',
        )}
        aria-label={t(locale, 'content.library.dropzoneAria')}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!pending) setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          beginUpload(event.dataTransfer.files[0]);
        }}
      >
        <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-paper text-primary/80 transition-colors group-hover:bg-brand-soft">
          {pending ? (
            <Spinner aria-hidden className="size-5" />
          ) : (
            <FileUpIcon className="size-5" strokeWidth={1.5} aria-hidden />
          )}
        </span>
        <span className="font-medium text-foreground">
          {t(locale, pending ? 'content.library.uploading' : 'content.library.dropzoneTitle')}
        </span>
        {!pending ? (
          <span className="mt-1.5 text-sm text-muted-foreground">{t(locale, 'content.library.dropzoneChoose')}</span>
        ) : null}
      </Button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".epub,application/epub+zip"
        aria-label={t(locale, 'content.library.dropzoneAria')}
        disabled={pending}
        onChange={onFileChange}
      />
    </div>
  );
}
