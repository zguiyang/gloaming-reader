'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUpIcon, XIcon } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

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

type LibraryUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFile?: File | null;
};

function formatFileSize(size: number, locale: string) {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (size >= 1024 * 1024) return `${number.format(size / (1024 * 1024))} MB`;
  if (size >= 1024) return `${number.format(size / 1024)} KB`;
  return `${size} B`;
}

export function LibraryUploadDialog({ open, onOpenChange, initialFile }: LibraryUploadDialogProps) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [validationError, setValidationError] = useState<'format' | 'size' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const uploadMutation = useMutation({
    mutationFn: uploadPersonalEpub,
    onSuccess: async () => {
      toast.success(t(locale, 'content.library.uploadStarted'));
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey.all });
      setFile(null);
      setValidationError(null);
      onOpenChange(false);
    },
    onError: (error) => toast.error(formatLibraryApiError(error)),
  });

  function selectFile(nextFile?: File) {
    if (!nextFile) return;
    setFile(nextFile);
    setValidationError(personalEpubValidationError(nextFile));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  function upload() {
    if (!file) return;
    const error = personalEpubValidationError(file);
    setValidationError(error);
    if (!error) uploadMutation.mutate(file);
  }

  const validationMessage = validationError
    ? t(locale, validationError === 'format' ? 'content.library.invalidEpub' : 'content.library.epubTooLarge')
    : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl bg-card text-foreground shadow-card ring-1 ring-border/50 outline-none sm:max-w-lg">
          <header className="flex items-start justify-between gap-4 border-b border-border/50 px-5 py-5 sm:px-7">
            <div>
              <DialogPrimitive.Title className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
                {t(locale, 'content.library.uploadDialogTitle')}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 text-sm text-muted-foreground">
                {t(locale, 'content.library.uploadDialogDescription')}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              render={<Button type="button" variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" />}
              aria-label={t(locale, 'common.close')}
            >
              <XIcon aria-hidden />
            </DialogPrimitive.Close>
          </header>

          <div className="flex flex-col gap-5 p-5 sm:p-7">
            <button
              type="button"
              className={cn(
                'flex min-h-44 w-full flex-col items-center justify-center rounded-lg border border-dashed px-5 py-7 text-center transition-colors',
                'border-border bg-background/60 hover:border-primary/50 hover:bg-paper/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                isDragging && 'border-primary/70 bg-paper',
                validationError && 'border-destructive/60 bg-destructive/5',
              )}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                selectFile(event.dataTransfer.files[0]);
              }}
              aria-label={t(locale, 'content.library.dropzoneAria')}
            >
              <FileUpIcon className="mb-3 size-6 text-primary/75" strokeWidth={1.5} aria-hidden />
              <span className="font-medium text-foreground">{t(locale, 'content.library.dropzoneTitle')}</span>
              <span className="mt-1 text-sm text-muted-foreground">{t(locale, 'content.library.dropzoneChoose')}</span>
              <span className="mt-3 text-xs text-muted-foreground/90">
                {t(locale, 'content.library.dropzoneLimit', { size: formatFileSize(EPUB_UPLOAD_MAX_BYTES, locale) })}
              </span>
            </button>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".epub,application/epub+zip"
              aria-label={t(locale, 'content.library.dropzoneAria')}
              onChange={onFileChange}
            />

            {file ? (
              <div className="flex min-w-0 items-center justify-between gap-4 rounded-md bg-muted/55 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                    {file.name}
                  </p>
                  <p className={cn('mt-0.5 text-xs', validationMessage ? 'text-destructive' : 'text-muted-foreground')}>
                    {validationMessage ??
                      t(locale, 'content.library.fileReady', { size: formatFileSize(file.size, locale) })}
                  </p>
                </div>
                {!uploadMutation.isPending ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setFile(null)}
                    aria-label={t(locale, 'common.close')}
                  >
                    <XIcon aria-hidden />
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogPrimitive.Close
                render={<Button variant="ghost" className="sm:min-w-24" disabled={uploadMutation.isPending} />}
              >
                {t(locale, 'common.close')}
              </DialogPrimitive.Close>
              <Button
                type="button"
                className="sm:min-w-32"
                disabled={!file || Boolean(validationError) || uploadMutation.isPending}
                onClick={upload}
              >
                {uploadMutation.isPending ? <Spinner aria-hidden /> : null}
                {t(locale, uploadMutation.isPending ? 'content.library.uploading' : 'content.library.uploadEpub')}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
