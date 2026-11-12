export const METADATA_FIELD_IDS = ['description'] as const;

export type MetadataFieldId = (typeof METADATA_FIELD_IDS)[number];

/** Maximum AI description length — aligned with WORK_DESCRIPTION_MAX. */
export const AI_DESCRIPTION_MAX = 2000 as const;
