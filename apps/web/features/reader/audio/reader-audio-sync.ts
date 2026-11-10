import type { TtsWordTiming } from '@gloaming/shared/tts';

/** Azure may emit punctuation-only boundaries; those must not drive highlight. */
export function isPunctuationOnlyTimingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  return /^[^\p{L}\p{N}]+$/u.test(trimmed);
}

export function stripEdgePunctuation(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

/**
 * Last non-punctuation word that has started at `timeMs`.
 * Kept until the next lexical word starts (stable follow-along; pause-friendly).
 */
export function findActiveWordTiming(wordTimings: readonly TtsWordTiming[], timeMs: number): TtsWordTiming | null {
  if (wordTimings.length === 0 || !Number.isFinite(timeMs) || timeMs < 0) {
    return null;
  }
  let active: TtsWordTiming | null = null;
  for (const timing of wordTimings) {
    if (timing.audioOffsetMs > timeMs) {
      break;
    }
    if (isPunctuationOnlyTimingText(timing.text)) {
      continue;
    }
    active = timing;
  }
  return active;
}

/** Stable identity for sync throttling (word change only). */
export function activeWordSyncKey(timing: TtsWordTiming | null): string {
  if (!timing) {
    return 'none';
  }
  return `${timing.textOffset}:${timing.audioOffsetMs}:${timing.text}`;
}

const SKIP_ANCESTOR_TAGS = new Set(['SUP', 'SUB', 'SCRIPT', 'STYLE']);

function isSkippedTextNode(node: Node): boolean {
  let el: Element | null = node.parentElement;
  while (el) {
    if (SKIP_ANCESTOR_TAGS.has(el.tagName) || el.hasAttribute('data-bilingual-translation')) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** Text nodes that participate in TTS-aligned reading (footnote markers excluded). */
export function collectReadableTextNodes(root: ParentNode): Text[] {
  const nodes: Text[] = [];
  const doc = root.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc?.createTreeWalker) {
    return nodes;
  }
  const showTextFilter = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
  const walker = doc.createTreeWalker(root, showTextFilter);
  let current = walker.nextNode();
  while (current) {
    const isText = current.nodeType === (typeof Node !== 'undefined' ? Node.TEXT_NODE : 3);
    if (isText && !isSkippedTextNode(current)) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  return nodes;
}

/** Minimal segment fields needed to scope word timings onto one paragraph chunk. */
export type SegmentTimingInput = {
  paragraphAnchor: string;
  paragraphTextOffset: number;
  textLength: number;
  wordTimings: readonly TtsWordTiming[];
};

/** Normalized paragraph text plus the map from normalized to raw-stream offsets. */
export type NormalizedParagraphText = {
  text: string;
  /** `rawIndex[i]` is the offset of `text[i]` in the raw concatenated stream. */
  rawIndex: number[];
};

/**
 * Collapse whitespace runs to single spaces (matching the backend segmenter's
 * `.replace(/\s+/g, ' ').trim()`) while recording, for every kept character,
 * its offset in the raw stream — so manifest `paragraphTextOffset` values can
 * be mapped back onto live DOM positions.
 */
export function normalizeParagraphStream(raw: string): NormalizedParagraphText {
  const chars: string[] = [];
  const rawIndex: number[] = [];
  let pendingSpaceRaw = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (/\s/.test(char)) {
      if (chars.length > 0 && pendingSpaceRaw < 0) {
        pendingSpaceRaw = i;
      }
      continue;
    }
    if (pendingSpaceRaw >= 0) {
      chars.push(' ');
      rawIndex.push(pendingSpaceRaw);
      pendingSpaceRaw = -1;
    }
    chars.push(char);
    rawIndex.push(i);
  }
  return { text: chars.join(''), rawIndex };
}

function rangeFromStreamOffset(nodes: readonly Text[], streamStart: number, streamEnd: number): Range | null {
  if (nodes.length === 0 || streamEnd <= streamStart) {
    return null;
  }
  const doc = nodes[0]!.ownerDocument;
  if (!doc) {
    return null;
  }

  let cursor = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of nodes) {
    const text = node.data;
    const next = cursor + text.length;
    if (startNode == null && streamStart < next) {
      startNode = node;
      startOffset = Math.max(0, streamStart - cursor);
    }
    if (streamEnd <= next) {
      endNode = node;
      endOffset = Math.max(0, streamEnd - cursor);
      break;
    }
    cursor = next;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = doc.createRange();
  range.setStart(startNode, Math.min(startOffset, startNode.data.length));
  range.setEnd(endNode, Math.min(endOffset, endNode.data.length));
  return range;
}

/**
 * Map one lazy-audio segment's lexical timings onto live DOM Ranges, scoped to
 * its paragraph (`[data-p="paragraphAnchor"]`). The manifest's
 * `paragraphTextOffset` anchors the sequential match inside the paragraph's
 * whitespace-normalized text, so repeated words earlier in the paragraph can
 * never steal a match. Missing paragraph or unmatchable words are omitted —
 * the caller degrades to no highlight for that word.
 */
export function buildSegmentTimingRanges(root: ParentNode | null, segment: SegmentTimingInput): Map<string, Range> {
  const result = new Map<string, Range>();
  if (!root) {
    return result;
  }
  let paragraph: Element | null = null;
  for (const element of root.querySelectorAll('[data-p]')) {
    if (element.getAttribute('data-p') === segment.paragraphAnchor) {
      paragraph = element;
      break;
    }
  }
  if (!paragraph) {
    return result;
  }

  const nodes = collectReadableTextNodes(paragraph);
  const raw = nodes.map((node) => node.data).join('');
  const normalized = normalizeParagraphStream(raw);
  const segStart = Math.min(Math.max(0, segment.paragraphTextOffset), normalized.text.length);
  const segEnd = Math.min(Math.max(segStart, segStart + segment.textLength), normalized.text.length);

  let cursor = segStart;
  for (const timing of segment.wordTimings) {
    if (isPunctuationOnlyTimingText(timing.text)) {
      continue;
    }
    const key = activeWordSyncKey(timing);
    const needles = [timing.text, stripEdgePunctuation(timing.text)].filter(
      (item, index, all) => item.length > 0 && all.indexOf(item) === index,
    );
    let found = -1;
    let usedLen = 0;
    for (const needle of needles) {
      const index = normalized.text.indexOf(needle, cursor);
      if (index >= 0 && index + needle.length <= segEnd) {
        found = index;
        usedLen = needle.length;
        break;
      }
    }
    if (found < 0 || usedLen <= 0) {
      continue;
    }
    // Sequential cursor — repeated words match in order, never from the top.
    cursor = found + usedLen;
    const rawStart = normalized.rawIndex[found];
    const rawEnd = normalized.rawIndex[found + usedLen - 1];
    if (rawStart == null || rawEnd == null) {
      continue;
    }
    const range = rangeFromStreamOffset(nodes, rawStart, rawEnd + 1);
    if (range) {
      result.set(key, range);
    }
  }
  return result;
}
