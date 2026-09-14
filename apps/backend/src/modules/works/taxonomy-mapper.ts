import type { WorkMetadataProvenance } from '@gloaming/db';
import { LANGUAGE_CODES, type LocalizedTextMap, type TaxonomyReference } from '@gloaming/shared/taxonomy';

const CANONICAL_LOCALE = 'en-US' as const;

export type TaxonomyRow = {
  id: string;
  name: string;
  localizedNames: LocalizedTextMap | null | undefined;
  origin: WorkMetadataProvenance;
  matchRule?: string | null;
};

/** Build the full locale map for API payloads — legacy `name` fills gaps when localized_names is empty. */
export function buildTaxonomyNames(
  localizedNames: LocalizedTextMap | null | undefined,
  legacyName: string,
): LocalizedTextMap {
  const payload: LocalizedTextMap = {};
  for (const code of LANGUAGE_CODES) {
    const value = localizedNames?.[code]?.trim();
    if (value) payload[code] = value;
  }
  if (!LANGUAGE_CODES.some((code) => payload[code])) {
    const fallback = legacyName.trim();
    if (fallback) payload[CANONICAL_LOCALE] = fallback;
  }
  return payload;
}

export function toTaxonomyReference(row: TaxonomyRow, options?: { includeMatchRule?: boolean }): TaxonomyReference {
  const ref: TaxonomyReference = {
    id: row.id,
    names: buildTaxonomyNames(row.localizedNames, row.name),
    origin: row.origin,
  };
  if (options?.includeMatchRule) {
    ref.matchRule = row.matchRule ?? null;
  }
  return ref;
}

export function toSourceReference(row: TaxonomyRow): TaxonomyReference {
  return toTaxonomyReference(row, { includeMatchRule: true });
}

/** Dedupe taxonomy references by stable id while preserving first-seen order. */
export function aggregateTaxonomyReferences(refs: TaxonomyReference[]): TaxonomyReference[] {
  const seen = new Set<string>();
  const ordered: TaxonomyReference[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) {
      continue;
    }
    seen.add(ref.id);
    ordered.push(ref);
  }
  return ordered;
}
