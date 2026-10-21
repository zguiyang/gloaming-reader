import { createHash } from 'node:crypto';

import { htmlToPlainText, normalizePartText } from '@/domains/works/content/part-text';

/**
 * Normalize title + HTML body so the source hash is stable across trivial
 * whitespace / markup churn. Hashing is based on the extracted plain text —
 * re-parsing the same content into different HTML keeps caches valid.
 * Used by translate cache and general part identity — not by TTS audio assets.
 */
export function normalizePartContent(title: string, body: string): string {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim();
  const normalizedBody = normalizePartText(htmlToPlainText(body));
  return `${normalizedTitle}\n\n${normalizedBody}`;
}

/** SSOT source-content hash for translate / non-audio derived projections. */
export function hashPartContent(title: string, body: string): string {
  return createHash('sha256').update(normalizePartContent(title, body), 'utf8').digest('hex');
}
