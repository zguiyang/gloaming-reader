import type { WorkMetadataProvenance } from '@gloaming/db';
import {
  type CatalogTaxonomyFacet,
  LANGUAGE_CODES,
  type LocalizedTextMap,
  type SourceReference,
  type TaxonomyReference,
} from '@gloaming/shared/taxonomy';

const CANONICAL_LOCALE = 'en-US' as const;

export type TaxonomyRow = {
  id: string;
  name: string;
  localizedNames?: LocalizedTextMap | null;
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

export function toTaxonomyReference(row: TaxonomyRow): TaxonomyReference {
  const ref: TaxonomyReference = {
    id: row.id,
    names: buildTaxonomyNames(row.localizedNames, row.name),
    origin: row.origin,
  };
  return ref;
}

/** Public catalog facet — localized names only, no provenance fields. */
export function toCatalogTaxonomyFacet(row: TaxonomyRow): CatalogTaxonomyFacet {
  return {
    id: row.id,
    names: buildTaxonomyNames(row.localizedNames, row.name),
  };
}

export function toSourceReference(row: TaxonomyRow): SourceReference {
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    matchRule: row.matchRule ?? null,
  };
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
