import type { TaxonomyProvenance, WorkCategorySnapshot, WorkTagSnapshot } from '@/domains/metadata/enrich/context';
import type { MetadataFieldId } from '@/domains/metadata/enrich/fields';
import { aiFillableFields, metadataFieldRegistry } from '@/domains/metadata/enrich/registry';
import { areWorkTagsWeak, isCategoryWeak } from '@/domains/metadata/enrich/taxonomy-localized';

export function hasNonManualTaxonomy(rows: Array<{ provenance: TaxonomyProvenance }>): boolean {
  return rows.some((row) => row.provenance !== 'manual');
}

export function selectFieldsNeedingAi(
  currentTags: WorkTagSnapshot[],
  currentCategory: WorkCategorySnapshot | undefined,
  description: string | null | undefined,
): Set<(typeof aiFillableFields)[number]> {
  const needed = new Set<(typeof aiFillableFields)[number]>();
  for (const id of aiFillableFields) {
    if (id === 'tags') {
      if (hasNonManualTaxonomy(currentTags) || areWorkTagsWeak(currentTags)) needed.add(id);
      continue;
    }
    if (id === 'category') {
      if ((currentCategory && currentCategory.provenance !== 'manual') || isCategoryWeak(currentCategory)) {
        needed.add(id);
      }
      continue;
    }
    const def = metadataFieldRegistry[id];
    if (def.isWeak(description ?? undefined)) {
      needed.add(id);
    }
  }
  return needed;
}

export function computeMetadataEnrichGaps(
  needed: Set<MetadataFieldId>,
  afterTags: WorkTagSnapshot[],
  afterCategory: WorkCategorySnapshot | undefined,
  afterDescription: string | null | undefined,
): MetadataFieldId[] {
  const gaps: MetadataFieldId[] = [];
  for (const id of needed) {
    if (id === 'tags') {
      if (areWorkTagsWeak(afterTags)) gaps.push(id);
      continue;
    }
    if (id === 'category') {
      if (isCategoryWeak(afterCategory)) gaps.push(id);
      continue;
    }
    const def = metadataFieldRegistry[id];
    if (def.isWeak(afterDescription ?? '')) gaps.push(id);
  }
  return gaps;
}
