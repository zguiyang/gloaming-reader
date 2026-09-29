'use client';

import { FileUpIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { t } from '@gloaming/i18n';

import { AUTH_ROUTES } from '@/constants';
import { LibraryUploadDialog } from '@/features/library/library-upload-dialog';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export function LibraryEmptyState() {
  const { locale } = useLocale();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-1 pb-10 pt-2 text-center md:pt-8">
      <h2 className="font-heading mb-6 text-xl font-medium tracking-tight text-foreground md:mb-8 md:text-2xl">
        {t(locale, 'content.library.emptyTitle')}
      </h2>
      <button
        type="button"
        className={cn(
          'group flex min-h-56 w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-9 transition-colors md:min-h-64',
          'border-border/80 bg-card/45 hover:border-primary/45 hover:bg-paper/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          isDragging && 'border-primary/65 bg-paper/75',
        )}
        onClick={() => {
          setDroppedFile(null);
          setIsUploadOpen(true);
        }}
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
          const file = event.dataTransfer.files[0];
          if (!file) return;
          setDroppedFile(file);
          setIsUploadOpen(true);
        }}
      >
        <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-paper text-primary/80 transition-colors group-hover:bg-brand-soft">
          <FileUpIcon className="size-5" strokeWidth={1.5} aria-hidden />
        </span>
        <span className="font-medium text-foreground">{t(locale, 'content.library.dropzoneTitle')}</span>
        <span className="mt-1.5 text-sm text-muted-foreground">{t(locale, 'content.library.dropzoneChoose')}</span>
      </button>
      <Link
        href={AUTH_ROUTES.discover}
        className="mt-5 rounded-sm text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {t(locale, 'content.common.findBookCta')}
      </Link>
      <LibraryUploadDialog
        key={isUploadOpen ? 'open' : 'closed'}
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        initialFile={droppedFile}
      />
    </div>
  );
}
