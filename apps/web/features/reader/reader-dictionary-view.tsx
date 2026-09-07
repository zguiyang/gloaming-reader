'use client';

import { useSyncExternalStore } from 'react';

import type { DictionaryEntry } from '@gloaming/shared/dictionary';

import { ReaderDictionaryPopover } from '@/features/reader/reader-dictionary-popover';
import { ReaderDictionarySheet } from '@/features/reader/reader-dictionary-sheet';
import type { ReaderSelectionRect } from '@/features/reader/reader-model';

function subscribeMd(onChange: () => void) {
  const mq = window.matchMedia('(min-width: 768px)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeMd,
    () => window.matchMedia('(min-width: 768px)').matches,
    () => true,
  );
}

export type ReaderDictionaryViewProps = {
  open: boolean;
  word: string;
  entry: DictionaryEntry | null | undefined;
  isLoading: boolean;
  contextSentence?: string;
  rect?: ReaderSelectionRect | null;
  top?: number;
  left?: number;
  onAskAi: (word: string, contextSentence?: string) => void;
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
