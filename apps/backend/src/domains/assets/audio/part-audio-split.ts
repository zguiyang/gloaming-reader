/**
 * Pack plain text into TTS request chunks under a character budget.
 * Short text → single segment (same pipeline as long text).
 */

const DEFAULT_MAX_CHARS = 4500;

const SENTENCE_END = /[.!?。？！]+["'")\]]*\s+|\n+/g;

export function splitForTts(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sentences: string[] = [];
  let last = 0;
  for (const match of normalized.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length;
    const piece = normalized.slice(last, end).trim();
    if (piece) {
      sentences.push(piece);
    }
    last = end;
  }
  const tail = normalized.slice(last).trim();
  if (tail) {
    sentences.push(tail);
  }
  if (sentences.length === 0) {
    return chunkByLength(normalized, maxChars);
  }

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...chunkByLength(sentence, maxChars));
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function chunkByLength(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}
