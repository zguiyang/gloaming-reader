import { z } from 'zod';

import { AI_DESCRIPTION_MAX, type MetadataFieldId } from '@/domains/metadata/enrich/fields';
import { isWeakDescription } from '@/domains/metadata/enrich/quality';

export const metadataFieldRegistry = {
  description: {
    id: 'description',
    aiFillable: true,
    promptSection: 'description: 2-3 sentences in the book language, no spoilers',
    outputKey: 'description',
    schema: z.string().max(AI_DESCRIPTION_MAX).optional(),
    isWeak: (value: string | undefined) => isWeakDescription(value ?? ''),
    normalize(value: unknown): string | undefined {
      if (typeof value !== 'string') return undefined;
      const text = value.replace(/\s+/g, ' ').trim();
      return text ? text.slice(0, AI_DESCRIPTION_MAX) : undefined;
    },
  },
} satisfies Record<
  MetadataFieldId,
  {
    id: MetadataFieldId;
    aiFillable: boolean;
    promptSection: string;
    outputKey: string;
    schema: z.ZodType;
    isWeak(value: string | undefined): boolean;
    normalize(value: unknown): unknown;
  }
>;

export const aiFillableFields = ['description'] as const;

export function buildMetadataOutputSchema(requiredFields: MetadataFieldId[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const id of requiredFields) {
    const field = metadataFieldRegistry[id];
    if (!field.aiFillable) continue;
    const base = field.schema;
    shape[id] = base instanceof z.ZodOptional ? base.unwrap() : base;
  }
  return z.object(shape);
}
