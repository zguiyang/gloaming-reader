import { z, type ZodType } from 'zod';

import { SUPPORTED_LOCALES } from '@gloaming/i18n';
import type { LocalizedTextMap } from '@gloaming/shared/taxonomy';

import {
  AI_DESCRIPTION_MAX,
  AI_TAG_MAX_ITEMS,
  METADATA_FIELD_IDS,
  type MetadataFieldId,
} from '@/modules/metadata-enrich/fields';
import { isStopwordTag, isWeakFieldValue } from '@/modules/metadata-enrich/quality';
import { buildLocalizedNamesMap, parseLocalizedNameEntries } from '@/modules/metadata-enrich/taxonomy-localized';

/**
 * Extensible per-field definition. Adding a new fillable field (e.g.
 * publishedYear) = register a new MetadataFieldDef; orchestration is untouched.
 */
export type MetadataFieldDef = {
  id: MetadataFieldId;
  /** source stays manual-only in this phase — never sent to the model. */
  aiFillable: boolean;
  /** Prompt section (single-book context only — no global data). */
  promptSection: string;
  /** Key under the structured output object. */
  outputKey: string;
  /** Output validation schema (post-invoke guard rails). */
  schema: ZodType;
  /** Weak-value check — empty/weak fields become fill targets. */
  isWeak(value: string | undefined): boolean;
  normalize(value: unknown): unknown;
};

export const localizedNameEntrySchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
  name: z.string().min(1).max(100),
});

/**
 * Taxonomy decision — flat shape for OpenAI strict JSON Schema (no oneOf).
 * `id` from list_* tools to reuse; `null` to create by `name`.
 * `localizedNames` carries per-locale labels for every supported locale.
 * Server validates ids and always falls back to normalized reuse-first upserts.
 */
export const taxonomyRefSchema = z.object({
  id: z.string().min(1).nullable().describe('Existing id from list_existing_tags / list_categories, or null to create'),
  name: z.string().min(1).max(100).describe('Fallback label when a supported locale is omitted'),
  localizedNames: z
    .array(localizedNameEntrySchema)
    .min(SUPPORTED_LOCALES.length)
    .max(SUPPORTED_LOCALES.length)
    .describe('Display name per supported locale'),
});

export type TaxonomyRef = z.infer<typeof taxonomyRefSchema>;

/** Resolve reuse id from flat `{ id }` or legacy `{ kind:"existing", id }`. */
function existingIdFromRef(ref: Record<string, unknown>): string | undefined {
  if (typeof ref.id === 'string' && ref.id) {
    // Flat schema: null means create; non-empty string means reuse.
    // Legacy discriminated: only trust id when kind is existing (or kind absent with id).
    if (ref.kind === 'new') return undefined;
    return ref.id;
  }
  return undefined;
}

export type CleanTaxonomyRef = {
  name: string;
  existingId?: string;
  localizedNames: LocalizedTextMap;
};

function cleanTaxonomyRef(raw: Record<string, unknown>, maxNameLen: number): CleanTaxonomyRef | undefined {
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 100) : '';
  if (!name) return undefined;
  const entries = parseLocalizedNameEntries(raw.localizedNames);
  const localizedNames = buildLocalizedNamesMap(entries, name);
  const existingId = existingIdFromRef(raw);
  return { name: name.slice(0, maxNameLen), localizedNames, ...(existingId ? { existingId } : {}) };
}

/** Clean, dedupe and cap an array of taxonomy refs; returns name + existingId + localizedNames. */
export function cleanTagRefs(value: unknown): CleanTaxonomyRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: CleanTaxonomyRef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const ref = raw as Record<string, unknown>;
    const cleaned = cleanTaxonomyRef(ref, 40);
    if (!cleaned || seen.has(cleaned.name.toLowerCase()) || isStopwordTag(cleaned.name)) continue;
    seen.add(cleaned.name.toLowerCase());
    out.push(cleaned);
    if (out.length >= AI_TAG_MAX_ITEMS) break;
  }
  return out.length > 0 ? out : undefined;
}

export function cleanCategoryRef(value: unknown): CleanTaxonomyRef | undefined {
  if (typeof value === 'string') {
    const name = value.trim().slice(0, 100);
    return name ? { name, localizedNames: buildLocalizedNamesMap([], name) } : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  return cleanTaxonomyRef(value as Record<string, unknown>, 100);
}

export const metadataFieldRegistry: Record<MetadataFieldId, MetadataFieldDef> = {
  description: {
    id: 'description',
    aiFillable: true,
    promptSection: 'description: 2-3 sentences in the book language, no spoilers',
    outputKey: 'description',
    schema: z.string().max(AI_DESCRIPTION_MAX).optional(),
    isWeak: isWeakFieldValue,
    normalize(value: unknown): string | undefined {
      if (typeof value !== 'string') return undefined;
      const text = value.replace(/\s+/g, ' ').trim();
      return text ? text.slice(0, AI_DESCRIPTION_MAX) : undefined;
    },
  },
  tags: {
    id: 'tags',
    aiFillable: true,
    promptSection: 'tags: localizedNames per supported locale — id from list_existing_tags or null to create',
    outputKey: 'tags',
    schema: z.array(taxonomyRefSchema).max(AI_TAG_MAX_ITEMS).optional(),
    /** Prefer `areProductTagsWeak(names[])` in orchestration — joined string is best-effort. */
    isWeak(value) {
      return !value || !value.trim();
    },
    normalize: cleanTagRefs,
  },
  category: {
    id: 'category',
    aiFillable: true,
    promptSection: 'category: localizedNames per supported locale — id from list_categories or null to create',
    outputKey: 'category',
    // Same as tags: required runs disallow null; reuse id or create via upsert.
    schema: taxonomyRefSchema.optional(),
    isWeak(value) {
      return !value || !value.trim();
    },
    normalize: cleanCategoryRef,
  },
  source: {
    id: 'source',
    aiFillable: false,
    promptSection: '',
    outputKey: 'source',
    schema: z.string().max(200).optional(),
    isWeak() {
      return false;
    },
    normalize(value: unknown) {
      return typeof value === 'string' ? value.trim() : undefined;
    },
  },
};

export const aiFillableFields = METADATA_FIELD_IDS.filter((id) => metadataFieldRegistry[id].aiFillable);

/**
 * Zod object for withStructuredOutput — built from the fields this run must
 * fill. Fields already complete are absent entirely, and required fields are
 * mandatory: the model cannot skip them, which is the fix for silent omission.
 */
export function buildMetadataOutputSchema(requiredFields: MetadataFieldId[]) {
  const shape: Record<string, ZodType> = {};
  for (const id of requiredFields) {
    const def = metadataFieldRegistry[id];
    if (!def.aiFillable) continue;
    const base = def.schema;
    shape[id] = (base instanceof z.ZodOptional ? base.unwrap() : base) as ZodType;
  }
  return z.object(shape);
}
