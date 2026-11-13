'use client';

import type { DictionaryEntry } from '@/shared/dictionary';

import { ReaderDictionaryPopover } from '@/features/reader/dictionary/reader-dictionary-popover';
import { ReaderDictionarySheet } from '@/features/reader/dictionary/reader-dictionary-sheet';
import type { ReaderSelectionRect } from '@/features/reader/reader-model';
import { useIsDesktop } from '@/lib/use-media-query';

export type ReaderDictionaryViewProps = {
  open: boolean;
  word: string;
  entry: DictionaryEntry | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  contextSentence?: string;
  rect?: ReaderSelectionRect | null;
  top?: number;
  left?: number;
  onAskAi: (word: string, contextSentence?: string) => void;
  onRetry?: () => void;
  onClose: () => void;
};

export function ReaderDictionaryView(props: ReaderDictionaryViewProps) {
  const isDesktop = useIsDesktop();

  if (!props.open) return null;

  if (isDesktop) {
    return <ReaderDictionaryPopover {...props} />;
  }

  return <ReaderDictionarySheet {...props} />;
}
