'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { useMemo } from 'react';

import type { DictionaryEntry } from '@gloaming/shared/dictionary';

import { ReaderDictionaryCard } from '@/features/reader/reader-dictionary-card';
import type { ReaderSelectionRect } from '@/features/reader/reader-model';
import { cn } from '@/lib/utils';

type ReaderDictionaryPopoverProps = {
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

export function ReaderDictionaryPopover({
  open,
  word,
  entry,
  isLoading,
  contextSentence,
  rect,
  top,
  left,
  onAskAi,
  onClose,
}: ReaderDictionaryPopoverProps) {
  const anchor = useMemo(() => {
    if (rect) {
      return {
        getBoundingClientRect: () =>
          ({
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            x: rect.left,
            y: rect.top,
            toJSON: () => rect,
          }) as DOMRect,
      };
    }
    if (top !== undefined && left !== undefined && (top !== 0 || left !== 0)) {
      return {
        getBoundingClientRect: () =>
          ({
            top,
            left,
            bottom: top,
            right: left,
            width: 0,
            height: 0,
            x: left,
            y: top,
            toJSON: () => ({ top, left, bottom: top, right: left, width: 0, height: 0 }),
          }) as DOMRect,
      };
    }
    return null;
  }, [rect, top, left]);

  if (!open || !anchor) return null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          side="bottom"
          align="center"
          sideOffset={8}
          collisionPadding={16}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-reader-ui
            role="dialog"
            aria-label="单词卡片"
            className={cn(
              'z-50 flex max-h-[min(28rem,calc(100vh-4rem))] w-[min(23rem,calc(100vw-2rem))] flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-card outline-hidden',
              'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
              'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            )}
          >
            <ReaderDictionaryCard
              word={word}
              entry={entry}
              isLoading={isLoading}
              contextSentence={contextSentence}
              onAskAi={onAskAi}
              onClose={onClose}
              className="max-h-[calc(28rem-2rem)]"
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
