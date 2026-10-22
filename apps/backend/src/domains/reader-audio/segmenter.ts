import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';

import { normalizeTtsInput } from '@gloaming/shared/tts';

import { reindexLeafParagraphOrdinals } from '@/domains/works/content';

/** Character budget per lazy audio segment — keep well under Azure request limits. */
export const SEGMENT_MAX_CHARS = 600;

/** Bump when segmentation / text normalization changes so stored segment identities invalidate. */
export const SEGMENT_PIPELINE_VERSION = 'reader-audio-v1';

/** Sentence boundary — kept from the legacy whole-chapter splitter. */
const SENTENCE_END = /[.!?。？！]+["'")\]]*\s+|\n+/g;

/** Elements whose text must never reach TTS (footnote markers, styles, injected translations). */
const EXCLUDED_SELECTOR = 'sup, sub, script, style, [data-bilingual-translation]';

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

export type ReaderAudioDerivedSegment = {
  /** Sequential index in document order across the whole part. */
  index: number;
  /** Stable within-part key — `p{paragraphAnchor}:c{chunkOrdinal}`. */
  key: string;
  /** Normalized plain chunk text (source space, before TTS risk-symbol mapping). */
  text: string;
  /** Text sent to Azure — `normalizeTtsInput(text).ttsText`. */
  synthText: string;
  /** sha256 of `synthText` — the durable segment identity. */
  segmentHash: string;
  /** Leaf-paragraph ordinal (`data-p`) this chunk belongs to. */
  paragraphAnchor: string;
  /** Chunk start offset within the paragraph's normalized plain text. */
  paragraphTextOffset: number;
  textLength: number;
};

type ChunkRange = { start: number; end: number };

function trimRange(text: string, start: number, end: number): ChunkRange | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s += 1;
  while (e > s && /\s/.test(text[e - 1]!)) e -= 1;
  return e > s ? { start: s, end: e } : null;
}

/**
 * Split one over-long sentenceless run inside the character budget, preferring
 * the last whitespace within the budget so words are never cut in half; a hard
 * cut at the budget happens only when the window contains no whitespace at all.
 */
function chunkByLength(text: string, range: ChunkRange, maxChars: number): ChunkRange[] {
  const out: ChunkRange[] = [];
  let start = range.start;
  while (start < range.end) {
    const hardEnd = Math.min(start + maxChars, range.end);
    if (hardEnd >= range.end) {
      out.push({ start, end: hardEnd });
      break;
    }
    // Walk back from the budget limit to the nearest whitespace boundary.
    let boundary = hardEnd;
    while (boundary > start && !/\s/.test(text[boundary - 1]!)) {
      boundary -= 1;
    }
    if (boundary <= start) {
      // No whitespace anywhere inside the window — unavoidable hard cut.
      out.push({ start, end: hardEnd });
      start = hardEnd;
      continue;
    }
    // `text[boundary - 1]` is whitespace — end the chunk before it…
    let end = boundary;
    while (end > start && /\s/.test(text[end - 1]!)) {
      end -= 1;
    }
    out.push({ start, end: Math.max(end, start) });
    // …and resume the next chunk after it, so the gap is exactly that space.
    start = boundary;
    while (start < range.end && /\s/.test(text[start]!)) {
      start += 1;
    }
  }
  return out;
}

/**
 * Split normalized paragraph text into ≤maxChars chunks on sentence boundaries,
 * recording each chunk's start offset in the source text. Input must already be
 * whitespace-collapsed, so contiguous chunk ranges differ only by single spaces.
 */
function splitParagraphChunks(text: string, maxChars: number): ChunkRange[] {
  if (!text) {
    return [];
  }
  if (text.length <= maxChars) {
    return [{ start: 0, end: text.length }];
  }

  const pieces: ChunkRange[] = [];
  let last = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length;
    const piece = trimRange(text, last, end);
    if (piece) {
      pieces.push(piece);
    }
    last = end;
  }
  const tail = trimRange(text, last, text.length);
  if (tail) {
    pieces.push(tail);
  }
  if (pieces.length === 0) {
    return chunkByLength(text, { start: 0, end: text.length }, maxChars);
  }

  const chunks: ChunkRange[] = [];
  let current: ChunkRange | null = null;
  for (const piece of pieces) {
    const pieceLength = piece.end - piece.start;
    if (pieceLength > maxChars) {
      if (current) {
        chunks.push(current);
        current = null;
      }
      chunks.push(...chunkByLength(text, piece, maxChars));
      continue;
    }
    if (!current) {
      current = piece;
      continue;
    }
    // Whitespace-collapsed text: the gap between consecutive pieces is a single space.
    if (piece.end - current.start > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = { start: current.start, end: piece.end };
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function paragraphPlainText($: cheerio.CheerioAPI, element: unknown): string {
  const $element = $(element as never).clone();
  $element.find(EXCLUDED_SELECTOR).remove();
  return $element.text().replace(/\s+/g, ' ').trim();
}

/**
 * Derive the ordered lazy-audio segment list for a part body. Reindexes leaf
 * paragraph ordinals first so anchors match the reader, then packs each
 * paragraph's plain text into ≤SEGMENT_MAX_CHARS sentence-bounded chunks.
 * Skips empty and punctuation-only chunks; never triggers synthesis.
 */
export function deriveReaderAudioSegments(bodyHtml: string): ReaderAudioDerivedSegment[] {
  if (!bodyHtml.trim()) {
    return [];
  }

  const html = reindexLeafParagraphOrdinals(bodyHtml);
  const $ = cheerio.load(html, null, false);
  const segments: ReaderAudioDerivedSegment[] = [];
  let index = 0;

  $('[data-p]').each((_, element) => {
    const paragraphAnchor = $(element).attr('data-p') ?? '';
    const paragraphText = paragraphPlainText($, element);
    if (!paragraphText) {
      return;
    }

    let chunkOrdinal = 0;
    for (const range of splitParagraphChunks(paragraphText, SEGMENT_MAX_CHARS)) {
      const chunkText = paragraphText.slice(range.start, range.end);
      const synthText = normalizeTtsInput(chunkText).ttsText;
      // Nothing pronounceable (empty / pure punctuation) — skip without consuming an index.
      if (!synthText.trim() || !HAS_WORD_CHAR.test(chunkText)) {
        continue;
      }
      segments.push({
        index,
        key: `p${paragraphAnchor}:c${chunkOrdinal}`,
        text: chunkText,
        synthText,
        segmentHash: createHash('sha256').update(synthText, 'utf8').digest('hex'),
        paragraphAnchor,
        paragraphTextOffset: range.start,
        textLength: chunkText.length,
      });
      index += 1;
      chunkOrdinal += 1;
    }
  });

  return segments;
}
