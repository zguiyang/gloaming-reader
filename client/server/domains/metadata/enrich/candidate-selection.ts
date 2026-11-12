import type { MetadataFieldId } from '@/server/domains/metadata/enrich/fields';
import { isWeakDescription } from '@/server/domains/metadata/enrich/quality';

export function selectFieldsNeedingAi(description: string | null | undefined): Set<MetadataFieldId> {
  return isWeakDescription(description ?? '') ? new Set(['description']) : new Set();
}

export function computeMetadataEnrichGaps(description: string | null | undefined): MetadataFieldId[] {
  return isWeakDescription(description ?? '') ? ['description'] : [];
}
