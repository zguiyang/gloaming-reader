'use client';

import DOMPurify from 'dompurify';
import { type MouseEvent, type ReactNode, useMemo } from 'react';

import type { TranslateSentenceEn } from '@gloaming/shared/translate';

import type { BilingualTranslationData } from '@/features/reader/use-reader-translate';
import { cn } from '@/lib/utils';

export type ReadingPartFontSize = 'sm' | 'md' | 'lg';

const FONT_CLASS: Record<ReadingPartFontSize, string> = {
  sm: 'text-lg leading-8 md:text-[18px] md:leading-8',
  md: 'text-[20px] leading-[1.8] md:leading-9',
  lg: 'text-[22px] leading-9 md:text-2xl md:leading-10',
};

export type ReadingPartViewProps = {
  html: string;
  fontSize?: ReadingPartFontSize;
  className?: string;
  /** Optional selection handling — the learner Reader wires its assist toolbar here. */
  onArticleMouseUp?: (event: MouseEvent<HTMLElement>) => void;
  /** Optional content after the reading body (e.g. the learner's chapter-end footer). */
  footer?: ReactNode;
  isBilingual?: boolean;
  bilingualData?: BilingualTranslationData | null;
  focusedSentenceIndex?: number | null;
  onSentenceClick?: (index: number) => void;
};

function splitElementIntoSentences(
  doc: Document,
  el: Element,
  pSentences: TranslateSentenceEn[],
  translationsByIndex: Record<number, string>,
  focusedSentenceIndex?: number | null,
) {
  if (pSentences.length === 1) {
    const sentence = pSentences[0]!;
    const zh = translationsByIndex[sentence.index];
    const isFocused = focusedSentenceIndex === sentence.index;

    const pairEl = doc.createElement('span');
    pairEl.className = cn(
      'sentence-pair group/sentence block my-2 first:mt-0 last:mb-0 rounded-md px-1.5 py-1 transition-colors duration-150',
      isFocused
        ? 'bg-amber-500/10 dark:bg-amber-400/10 ring-1 ring-amber-500/20'
        : 'hover:bg-amber-500/10 dark:hover:bg-amber-400/10',
    );
    pairEl.setAttribute('data-sentence-pair', 'true');
    pairEl.setAttribute('data-sentence-index', String(sentence.index));

    const enSpan = doc.createElement('span');
    enSpan.className = 'sentence-en block text-foreground font-reading';
    enSpan.setAttribute('data-sentence-index', String(sentence.index));

    while (el.firstChild) {
      enSpan.appendChild(el.firstChild);
    }
    pairEl.appendChild(enSpan);

    if (zh) {
      const zhSpan = doc.createElement('span');
      zhSpan.setAttribute('data-bilingual-translation', 'true');
      zhSpan.setAttribute('data-sentence-index', String(sentence.index));
      zhSpan.className = cn(
        'sentence-zh block text-sm font-sans text-muted-foreground/75 leading-relaxed mt-1 select-text transition-[opacity,color] duration-150 group-hover/sentence:text-foreground group-hover/sentence:opacity-100',
        isFocused
          ? 'text-foreground opacity-100 font-medium'
          : focusedSentenceIndex !== null && focusedSentenceIndex !== undefined
            ? 'opacity-40'
            : '',
      );
      zhSpan.textContent = zh;
      pairEl.appendChild(zhSpan);
    }

    el.appendChild(pairEl);
    return;
  }

  const textNodes: Text[] = [];
  const showText = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
  const walker = doc.createTreeWalker(el, showText);
  let curr = walker.nextNode();
  while (curr) {
    if (curr.nodeType === (typeof Node !== 'undefined' ? Node.TEXT_NODE : 3)) {
      textNodes.push(curr as Text);
    }
    curr = walker.nextNode();
  }

  if (textNodes.length === 0) {
    return;
  }

  let fullText = '';
  const nodeRanges: { node: Text; start: number; end: number }[] = [];
  for (const node of textNodes) {
    const start = fullText.length;
    fullText += node.data;
    nodeRanges.push({ node, start, end: fullText.length });
  }

  let searchPos = 0;
  const sentenceCharRanges: { start: number; end: number; sentence: TranslateSentenceEn }[] = [];

  for (const s of pSentences) {
    let idx = fullText.indexOf(s.en, searchPos);
    if (idx === -1) {
      const normalizedEn = s.en.replace(/\s+/g, ' ').trim();
      const slice = fullText.slice(searchPos);
      const approx = slice.indexOf(normalizedEn);
      if (approx !== -1) {
        idx = searchPos + approx;
      }
    }

    if (idx !== -1) {
      sentenceCharRanges.push({
        start: idx,
        end: idx + s.en.length,
        sentence: s,
      });
      searchPos = idx + s.en.length;
    }
  }

  if (sentenceCharRanges.length !== pSentences.length) {
    // Fallback: If exact range matching failed, append translations sequentially to avoid broken rendering
    const fallbackContainer = doc.createElement('div');
    fallbackContainer.className = 'mt-1 mb-2 space-y-1';
    for (const s of pSentences) {
      const zh = translationsByIndex[s.index];
      if (zh) {
        const fallbackZh = doc.createElement('div');
        fallbackZh.setAttribute('data-bilingual-translation', 'true');
        fallbackZh.setAttribute('data-sentence-index', String(s.index));
        fallbackZh.className = 'text-sm font-sans text-muted-foreground/75 leading-relaxed select-text';
        fallbackZh.textContent = zh;
        fallbackContainer.appendChild(fallbackZh);
      }
    }
    if (fallbackContainer.childNodes.length > 0) {
      el.insertAdjacentElement('afterend', fallbackContainer);
    }
    return;
  }

  function getNodeAndOffset(pos: number): { node: Text; offset: number } {
    for (const item of nodeRanges) {
      if (pos >= item.start && pos <= item.end) {
        return { node: item.node, offset: Math.min(item.node.data.length, Math.max(0, pos - item.start)) };
      }
    }
    const last = nodeRanges[nodeRanges.length - 1]!;
    return { node: last.node, offset: last.node.data.length };
  }

  const pairs: HTMLElement[] = [];
  for (const { start, end, sentence } of sentenceCharRanges) {
    const isFocused = focusedSentenceIndex === sentence.index;
    const pairEl = doc.createElement('span');
    pairEl.className = cn(
      'sentence-pair group/sentence block my-2 first:mt-0 last:mb-0 rounded-md px-1.5 py-1 transition-colors duration-150',
      isFocused
        ? 'bg-amber-500/10 dark:bg-amber-400/10 ring-1 ring-amber-500/20'
        : 'hover:bg-amber-500/10 dark:hover:bg-amber-400/10',
    );
    pairEl.setAttribute('data-sentence-pair', 'true');
    pairEl.setAttribute('data-sentence-index', String(sentence.index));

    const enSpan = doc.createElement('span');
    enSpan.className = 'sentence-en block text-foreground font-reading';
    enSpan.setAttribute('data-sentence-index', String(sentence.index));

    let isAppended = false;
    if (doc.createRange) {
      try {
        const range = doc.createRange();
        const startPoint = getNodeAndOffset(start);
        const endPoint = getNodeAndOffset(end);
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, endPoint.offset);
        const cloned = range.cloneContents();
        if (cloned.childNodes.length > 0 && (cloned.textContent?.length ?? 0) > 0) {
          enSpan.appendChild(cloned);
          isAppended = true;
        }
      } catch {
        // ignore and fallback
      }
    }
    if (!isAppended) {
      enSpan.textContent = sentence.en;
    }
    pairEl.appendChild(enSpan);

    const zh = translationsByIndex[sentence.index];
    if (zh) {
      const zhSpan = doc.createElement('span');
      zhSpan.setAttribute('data-bilingual-translation', 'true');
      zhSpan.setAttribute('data-sentence-index', String(sentence.index));
      zhSpan.className = cn(
        'sentence-zh block text-sm font-sans text-muted-foreground/75 leading-relaxed mt-1 select-text transition-[opacity,color] duration-150 group-hover/sentence:text-foreground group-hover/sentence:opacity-100',
        isFocused
          ? 'text-foreground opacity-100 font-medium'
          : focusedSentenceIndex !== null && focusedSentenceIndex !== undefined
            ? 'opacity-40'
            : '',
      );
      zhSpan.textContent = zh;
      pairEl.appendChild(zhSpan);
    }

    pairs.push(pairEl);
  }

  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
  for (const pair of pairs) {
    el.appendChild(pair);
  }
}

function sanitizeHtml(html: string): string {
  if (typeof window !== 'undefined' && typeof DOMPurify?.sanitize === 'function') {
    return DOMPurify.sanitize(html);
  }
  return html;
}

export function transformBilingualHtml(
  html: string,
  options: {
    isBilingual?: boolean;
    bilingualData?: BilingualTranslationData | null;
    focusedSentenceIndex?: number | null;
    parserDoc?: Document;
  },
): string {
  const { isBilingual = false, bilingualData, focusedSentenceIndex, parserDoc } = options;
  const sanitizedHtml = sanitizeHtml(html);
  if (!isBilingual || !bilingualData) {
    return sanitizedHtml;
  }

  const { sentences, translationsByIndex } = bilingualData;
  if (sentences.length === 0) {
    return sanitizedHtml;
  }

  let doc = parserDoc;
  if (!doc) {
    if (typeof DOMParser === 'undefined') {
      return sanitizedHtml;
    }
    const parser = new DOMParser();
    doc = parser.parseFromString(sanitizedHtml, 'text/html');
  }

  const sentencesByParagraph = new Map<number, TranslateSentenceEn[]>();
  for (const sentence of sentences) {
    const list = sentencesByParagraph.get(sentence.paragraphIndex) ?? [];
    list.push(sentence);
    sentencesByParagraph.set(sentence.paragraphIndex, list);
  }

  doc.querySelectorAll('[data-p]').forEach((el) => {
    const pIndex = Number(el.getAttribute('data-p'));
    const pSentences = sentencesByParagraph.get(pIndex);
    if (pSentences && pSentences.length > 0) {
      splitElementIntoSentences(doc!, el, pSentences, translationsByIndex, focusedSentenceIndex);
    }
  });

  return doc.body.innerHTML;
}

/**
 * Pure reading typography shared by the learner Reader and the admin preview —
 * the single place that renders normalized reading HTML in a reading column.
 * Outer article is chrome (column width + padding); `.reading-body` is a
 * scoped document-flow surface — spacing comes from content tags, not flex gap.
 */
export function ReadingPartView({
  html,
  fontSize = 'md',
  className,
  onArticleMouseUp,
  footer,
  isBilingual = false,
  bilingualData,
  focusedSentenceIndex,
  onSentenceClick,
}: ReadingPartViewProps) {
  const renderedHtml = useMemo(
    () =>
      transformBilingualHtml(html, {
        isBilingual,
        bilingualData,
        focusedSentenceIndex,
      }),
    [html, isBilingual, bilingualData, focusedSentenceIndex],
  );

  const handleArticleClick = (event: MouseEvent<HTMLElement>) => {
    if (!onSentenceClick) return;
    const target = event.target as HTMLElement | null;
    const sentenceEl = target?.closest('[data-sentence-index]');
    if (sentenceEl) {
      const idxAttr = sentenceEl.getAttribute('data-sentence-index');
      if (idxAttr) {
        onSentenceClick(Number(idxAttr));
      }
    }
  };

  return (
    <article
      onMouseUp={onArticleMouseUp}
      onClick={handleArticleClick}
      className={cn(
        // Readest-aligned page insets: 16/20 L-R, compact top; large pb clears TTS/chrome.
        'mx-auto w-full max-w-reading-column px-4 pb-24 pt-6 md:px-5 md:pt-8',
        FONT_CLASS[fontSize],
        className,
      )}
    >
      <div
        className="reading-body font-reading text-foreground/90 text-pretty selection:bg-accent selection:text-brand-deep"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />

      {footer}
    </article>
  );
}
