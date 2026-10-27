import { type Locale, t } from '@gloaming/i18n';
import type { LibraryItem } from '@gloaming/shared/library';

/**
 * Normalized title key for contextual duplicate detection within the currently
 * rendered Library list only. It is display context, not Work identity, and
 * must never be used for matching, merging, or persistence.
 */
export function libraryTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Keys of titles that appear more than once in the rendered list (same title, different Works). */
export function duplicatedLibraryTitleKeys(titles: Iterable<string>): Set<string> {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const key = libraryTitleKey(title);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

/** UTC year for a projected publish date; null when absent or unparsable. */
export function publishedYear(publishedAt: string | Date | null): number | null {
  if (publishedAt === null) {
    return null;
  }
  const date = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

/**
 * Trustworthy same-title discriminators for one Library card: origin kind,
 * the owner-edited author (Personal Works only, when set), and the publish
 * year only when the Work actually projects one. Never invents metadata.
 */
export function libraryTitleContext(entry: LibraryItem, locale: Locale): string[] {
  const parts = [
    t(locale, entry.libraryItemKind === 'personal' ? 'content.library.sourcePersonal' : 'content.library.sourceSaved'),
  ];
  const author = entry.personalMetadata?.author?.trim();
  if (author) {
    parts.push(author);
  }
  const year = publishedYear(entry.work.publishedAt);
  if (year !== null) {
    parts.push(t(locale, 'content.library.publishedYear', { year }));
  }
  return parts;
}
