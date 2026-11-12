'use client';

import { t } from '@gloaming/i18n';
import type { DictionaryEntry } from '@gloaming/shared/dictionary';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ReaderDictionaryCard } from '@/features/reader/dictionary/reader-dictionary-card';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type ReaderDictionarySheetProps = {
  open: boolean;
  word: string;
  entry: DictionaryEntry | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  contextSentence?: string;
  onAskAi: (word: string, contextSentence?: string) => void;
  onRetry?: () => void;
  onClose: () => void;
};

export function ReaderDictionarySheet({
  open,
  word,
  entry,
  isLoading,
  isError,
  contextSentence,
  onAskAi,
  onRetry,
  onClose,
}: ReaderDictionarySheetProps) {
  const { locale } = useLocale();

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn(
          'max-h-[85dvh] rounded-t-3xl border-t border-border/60 bg-card px-4 pt-2 pb-6 shadow-card outline-hidden',
        )}
      >
        {/* Grab Handle */}
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-border/80" />

        <SheetHeader className="sr-only">
          <SheetTitle>{t(locale, 'content.reader.dictionary.sheetTitle', { word })}</SheetTitle>
        </SheetHeader>

        <ReaderDictionaryCard
          word={word}
          entry={entry}
          isLoading={isLoading}
          isError={isError}
          contextSentence={contextSentence}
          onAskAi={onAskAi}
          onRetry={onRetry}
          onClose={onClose}
          className="max-h-[calc(85dvh-3.5rem)]"
        />
      </SheetContent>
    </Sheet>
  );
}
