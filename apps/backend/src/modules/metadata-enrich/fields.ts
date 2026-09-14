export const METADATA_FIELD_IDS = ['description', 'tags', 'category', 'source'] as const;

export type MetadataFieldId = (typeof METADATA_FIELD_IDS)[number];

/** Minimum AI-produced tags per work — quality gate, never padded with guesses. */
export const AI_TAG_MIN_ITEMS = 1 as const;

/** Maximum AI-produced tags per work — concise reader-facing metadata. */
export const AI_TAG_MAX_ITEMS = 3 as const;

/** Maximum AI description length — aligned with WORK_DESCRIPTION_MAX. */
export const AI_DESCRIPTION_MAX = 2000 as const;
