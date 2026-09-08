'use client';

import type { DictionaryEntry } from '@gloaming/shared/dictionary';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ReaderDictionaryCard } from '@/features/reader/dictionary/reader-dictionary-card';
import { cn } from '@/lib/utils';

type ReaderDictionarySheetProps = {
  open: boolean;
  word: string;
  entry: DictionaryEntry | null | undefined;
  isLoading: boolean;
  contextSentence?: string;
  onAskAi: (word: string, contextSentence?: string) => void;
  onClose: () => void;
};

export function ReaderDictionarySheet({
  open,
  word,
  entry,
  isLoading,
  contextSentence,
  onAskAi,
  onClose,
}: ReaderDictionarySheetProps) {
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
          <SheetTitle>单词查词 - {word}</SheetTitle>
          <SheetDescription>词典释义与语境解读</SheetDescription>
        </SheetHeader>

        <ReaderDictionaryCard
          word={word}
          entry={entry}
          isLoading={isLoading}
          contextSentence={contextSentence}
          onAskAi={onAskAi}
          onClose={onClose}
          className="max-h-[calc(85dvh-3.5rem)]"
        />
      </SheetContent>
    </Sheet>
  );
}
