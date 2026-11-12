'use client';

import type { KeyboardEvent, MouseEvent, ReactNode, Ref, UIEvent } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { type BilingualTranslationData, ReadingPartView } from '@/features/content';
import type { ReaderFontSize, ReaderSelectionRect } from '@/features/reader/reader-model';
import { cn } from '@/lib/utils';

type ReaderPartProps = {
  partId: string;
  html: string;
  fontSize: ReaderFontSize;
  aiDrawerOpen: boolean;
  tocOpen?: boolean;
  isBilingual?: boolean;
  bilingualData?: BilingualTranslationData | null;
  focusedSentenceIndex?: number | null;
  onSentenceClick?: (index: number) => void;
  /** Scroll container — parent queries `.reading-body` for listen highlight. */
  contentRef?: Ref<HTMLDivElement | null>;
  onSelectText: (payload: {
    quote: string;
    paragraphId: string;
    contextSentence?: string;
    sentenceIndex?: number;
    rect?: ReaderSelectionRect;
    top: number;
    left: number;
  }) => void;
  onCenterTap: () => void;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  footer?: ReactNode;
};

/** Extract the full sentence surrounding the selected quote from paragraph text. */
function extractContextSentence(paragraphText: string, quote: string): string {
  if (!paragraphText || !quote) return paragraphText;
  const sentences = paragraphText.match(/[^.!?。！？]+[.!?。！？]*/g) || [paragraphText];
  const matched = sentences.find((s) => s.toLowerCase().includes(quote.toLowerCase()));
  return (matched || paragraphText).trim();
}

/** Paragraph id from the server-injected data-p ordinal. */
function paragraphIdFromElement(el: HTMLElement | null, partId: string, fallback: string): string {
  const dataP = el?.getAttribute('data-p');
  if (dataP) {
    return `${partId}-p${Number(dataP) + 1}`;
  }
  return fallback;
}

export function ReaderPart({
  partId,
  html,
  fontSize,
  aiDrawerOpen,
  tocOpen = false,
  isBilingual = false,
  bilingualData,
  focusedSentenceIndex,
  onSentenceClick,
  contentRef,
  onSelectText,
  onCenterTap,
  onScroll,
  footer,
}: ReaderPartProps) {
  function handleSelection(target: Element, article: HTMLElement) {
    const selection = window.getSelection();
    const quote = selection?.toString().trim() ?? '';
    if (
      !quote ||
      quote.length < 2 ||
      !selection?.anchorNode ||
      !selection.focusNode ||
      !article.contains(selection.anchorNode) ||
      !article.contains(selection.focusNode)
    ) {
      return;
    }

    const paragraphEl = target.closest('[data-p]') as HTMLElement | null;
    const paragraphId = paragraphIdFromElement(paragraphEl, partId, `${partId}-p1`);
    const paragraphText = paragraphEl?.textContent?.trim() || '';
    const contextSentence = extractContextSentence(paragraphText, quote);
    const sentenceEl = target.closest('[data-sentence-index]') as HTMLElement | null;
    const sentenceIndexAttr = sentenceEl?.getAttribute('data-sentence-index');
    const sentenceIndex = sentenceIndexAttr ? Number(sentenceIndexAttr) : undefined;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    if (!rect) return;

    onSelectText({
      quote,
      paragraphId,
      contextSentence,
      sentenceIndex: sentenceIndex !== undefined && !Number.isNaN(sentenceIndex) ? sentenceIndex : undefined,
      rect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      },
      top: rect.bottom + 8,
      left: Math.min(Math.max(16, rect.left + rect.width / 2), window.innerWidth - 16),
    });
  }

  function handleMouseUp(event: MouseEvent<HTMLElement>) {
    handleSelection(event.target as HTMLElement, event.currentTarget);
  }

  function handleKeyUp(event: KeyboardEvent<HTMLElement>) {
    // Wait until Shift is released so extending a selection doesn't steal focus.
    if (event.key !== 'Shift') return;
    const anchor = window.getSelection()?.anchorNode;
    const target = anchor instanceof Element ? anchor : anchor?.parentElement;
    if (target) handleSelection(target, event.currentTarget);
  }

  function handleContentClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, [data-reader-ui]')) return;

    const y = event.clientY / window.innerHeight;
    const x = event.clientX / window.innerWidth;
    if (y > 0.2 && y < 0.8 && x > 0.15 && x < 0.85) {
      const selection = window.getSelection()?.toString().trim();
      if (selection) return;
      onCenterTap();
    }
  }

  return (
    <div
      ref={contentRef}
      className={cn(
        'relative h-full flex-1 overflow-y-auto transition-[margin,padding] duration-300 ease-out-soft',
        aiDrawerOpen && 'md:pr-96',
        tocOpen && 'md:ml-80',
      )}
      onScroll={onScroll}
      onClick={handleContentClick}
    >
      <ReadingPartView
        html={html}
        fontSize={fontSize}
        isBilingual={isBilingual}
        bilingualData={bilingualData}
        focusedSentenceIndex={focusedSentenceIndex}
        onSentenceClick={onSentenceClick}
        onArticleMouseUp={handleMouseUp}
        onArticleKeyUp={handleKeyUp}
        footer={footer}
      />
    </div>
  );
}

export function ReaderPartSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-reading-column flex-col gap-6 px-4 py-16 md:px-5 md:py-20">
      <div className="mt-2 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-5 rounded bg-surface-container-high"
            style={{ width: `${88 - (i % 3) * 8}%` }}
          />
        ))}
      </div>
    </div>
  );
}
