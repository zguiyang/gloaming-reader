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

export type StreamRange = {
  /** Inclusive start index in the concatenated readable stream. */
  start: number;
  /** Exclusive end index. */
  end: number;
};

/**
 * Sequential needle match of lexical timings into a concatenated readable text stream.
 * Prefer over raw Azure `textOffset` — HTML whitespace / dropped footnotes disagree with synth.
 */
export function alignTimingsToStream(stream: string, wordTimings: readonly TtsWordTiming[]): Map<string, StreamRange> {
  const map = new Map<string, StreamRange>();
  let cursor = 0;
  for (const timing of wordTimings) {
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
      const index = stream.indexOf(needle, cursor);
      if (index >= 0) {
        found = index;
        usedLen = needle.length;
        break;
      }
    }
    if (found < 0 || usedLen <= 0) {
      continue;
    }
    map.set(key, { start: found, end: found + usedLen });
    cursor = found + usedLen;
  }
  return map;
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
 * Map lexical word timings onto live DOM Ranges under `root` (typically `.reading-body`).
 * Failed matches are omitted — caller degrades to no highlight for that word.
 */
export function buildTimingRanges(root: ParentNode, wordTimings: readonly TtsWordTiming[]): Map<string, Range> {
  const nodes = collectReadableTextNodes(root);
  const stream = nodes.map((node) => node.data).join('');
  const streamMap = alignTimingsToStream(stream, wordTimings);
  const result = new Map<string, Range>();
  for (const [key, span] of streamMap) {
    const range = rangeFromStreamOffset(nodes, span.start, span.end);
    if (range) {
      result.set(key, range);
    }
  }
  return result;
}
