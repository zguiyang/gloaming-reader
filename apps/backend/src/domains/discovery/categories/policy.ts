import {
  PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
  type PublicCategory,
  type PublicCategoryListItem,
  type PublicCategoryManagementItem,
  type PublicCategoryProvenance,
  type PublicCategorySummary,
  resolvePublicCategoryName,
} from '@gloaming/shared/discovery';

/** Label row shape needed to assemble the shared `PublicCategory` contract. */
export type PublicCategoryLabelInput = {
  locale: string;
  name: string;
  editedBy: PublicCategoryProvenance;
};

/** Alias row shape needed to assemble the shared `PublicCategory` contract. */
export type PublicCategoryAliasInput = {
  locale: string;
  alias: string;
  editedBy: PublicCategoryProvenance;
};

/**
 * Assemble the shared `PublicCategory` contract from persisted rows. `manualLocales`
 * is derived from `edited_by = 'manual'` labels so a manually edited label is
 * protected without duplicating that fact in another column.
 */
export function buildPublicCategory(input: {
  id: string;
  createdBy: PublicCategoryProvenance;
  sourceLocale: string | null;
  meaning: string | null;
  labels: PublicCategoryLabelInput[];
  aliases: PublicCategoryAliasInput[];
}): PublicCategory {
  const localizedNames: Record<string, string> = {};
  const manualLocales: string[] = [];
  for (const label of input.labels) {
    localizedNames[label.locale] = label.name;
    if (label.editedBy === 'manual') {
      manualLocales.push(label.locale);
    }
  }

  return {
    id: input.id,
    createdBy: input.createdBy,
    sourceLocale: input.sourceLocale,
    meaning: input.meaning,
    manualLocales,
    localizedNames,
    aliases: input.aliases.map((alias) => ({
      locale: alias.locale,
      alias: alias.alias,
      editedBy: alias.editedBy,
    })),
  };
}

/**
 * Minimal public projection. Returns `null` when the category has no label at
 * all, because a Discover summary without a display name cannot be rendered.
 */
export function toPublicCategorySummary(category: PublicCategory, locale: string): PublicCategorySummary | null {
  const name = resolvePublicCategoryName(category, locale);
  return name === null ? null : { id: category.id, name };
}

/** Public list/detail item: minimal summary plus the public record count. */
export function toPublicCategoryListItem(
  category: PublicCategory,
  locale: string,
  recordCount: number,
): PublicCategoryListItem | null {
  const summary = toPublicCategorySummary(category, locale);
  return summary === null ? null : { ...summary, recordCount };
}

/** Admin management projection: the full contract plus the assigned record count. */
export function toPublicCategoryManagementItem(
  category: PublicCategory,
  recordCount: number,
): PublicCategoryManagementItem {
  return { ...category, recordCount };
}

export type CategoryAssignmentDecision = 'insert' | 'promote' | 'keep' | 'noop' | 'limit';

/**
 * Decide how one assignment request resolves against the current pair/count.
 *
 * - A `manual` assignment always wins: it inserts, or promotes an existing `ai`
 *   row to `manual`, and clears any suppression before reaching this policy.
 * - An `ai` assignment never overrides a `manual` row and never restores an
 *   explicitly suppressed pair (it becomes a no-op), and an existing `ai` row is
 *   already idempotent.
 * - A net-new assignment of either provenance is rejected once the record already
 *   holds `PUBLIC_CATEGORY_ASSIGNMENT_LIMIT` categories.
 */
export function decideCategoryAssignment(input: {
  incomingSource: PublicCategoryProvenance;
  existingSource: PublicCategoryProvenance | null;
  assignmentCount: number;
  suppressed: boolean;
}): CategoryAssignmentDecision {
  if (input.incomingSource === 'manual') {
    if (input.existingSource === 'manual') return 'noop';
    if (input.existingSource === 'ai') return 'promote';
    return input.assignmentCount >= PUBLIC_CATEGORY_ASSIGNMENT_LIMIT ? 'limit' : 'insert';
  }

  if (input.existingSource === 'manual') return 'keep';
  if (input.existingSource === 'ai') return 'noop';
  if (input.suppressed) return 'keep';
  return input.assignmentCount >= PUBLIC_CATEGORY_ASSIGNMENT_LIMIT ? 'limit' : 'insert';
}

/**
 * An explicit removal of an existing assignment always records suppression for
 * that exact pair, regardless of the removed row's provenance, so a later AI
 * retry cannot restore it. Removing a pair that was never assigned is a no-op.
 */
export function shouldSuppressOnRemoval(existingSource: PublicCategoryProvenance | null): boolean {
  return existingSource !== null;
}
