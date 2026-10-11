import type { Locale } from '@gloaming/i18n';
import {
  canonicalizePublicCategoryName,
  normalizePublicCategoryName,
  PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
  type PublicCategory,
  publicCategoryNameSchema,
} from '@gloaming/shared/discovery';

import type {
  PublicCategoryTranslationOutput,
  PublicClassificationCreate,
  PublicClassificationDecision,
  PublicClassificationOutcome,
  PublicClassificationReuse,
} from '@/domains/discovery/categories/classification-contract';

/** Server-validated decision after dropping ids/names the model was not allowed to use. */
export type ValidatedPublicClassificationDecision = {
  outcome: PublicClassificationOutcome;
  reuse: PublicClassificationReuse[];
  create: PublicClassificationCreate[];
};

/**
 * Script guard mirroring the Personal Tag creation check. It rejects a new label
 * whose writing system does not match the locale it is created for, so a model
 * cannot pass an English name as a Chinese category (or vice versa).
 */
export function matchesLocaleScript(name: string, locale: Locale): boolean {
  const script = new Intl.Locale(locale).maximize().script;
  const has = (pattern: RegExp) => pattern.test(name);
  switch (script) {
    case 'Hans':
    case 'Hant':
      return has(/\p{Script=Han}/u);
    case 'Jpan':
      return has(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
    case 'Kore':
      return has(/\p{Script=Hangul}/u);
    case 'Arab':
      return has(/\p{Script=Arabic}/u);
    case 'Cyrl':
      return has(/\p{Script=Cyrillic}/u);
    case 'Grek':
      return has(/\p{Script=Greek}/u);
    case 'Latn':
      return (
        has(/\p{Script=Latin}/u) && !has(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u)
      );
    default:
      return false;
  }
}

/** Every normalized label/alias already owned by the supplied public categories. */
export function collectExistingCategoryNames(candidates: PublicCategory[]): Set<string> {
  return new Set(collectExistingCategoryNameOwners(candidates).keys());
}

/**
 * Normalized label/alias name to the stable id that owns it. When `locale` is
 * supplied, only labels in that locale are considered because name uniqueness
 * is locale-scoped. Used to turn an exact same-locale collision into safe reuse.
 */
export function collectExistingCategoryNameOwners(candidates: PublicCategory[], locale?: Locale): Map<string, string> {
  const owners = new Map<string, string>();
  for (const category of candidates) {
    const names = locale
      ? [category.localizedNames[locale]].filter((name): name is string => Boolean(name))
      : Object.values(category.localizedNames);
    for (const name of names) {
      owners.set(normalizePublicCategoryName(name), category.id);
    }
    for (const alias of category.aliases) {
      if (locale && alias.locale !== locale) continue;
      owners.set(normalizePublicCategoryName(alias.alias), category.id);
    }
  }
  return owners;
}

function normalizeNewCategoryName(name: string): string | null {
  const parsed = publicCategoryNameSchema.safeParse(name);
  if (!parsed.success) return null;
  return canonicalizePublicCategoryName(parsed.data);
}

/**
 * Server-side revalidation of one model decision.
 *
 * - Reuse ids must exist in the supplied public category set; unknown or
 *   duplicated ids are dropped, so no model id can touch a User Tag or an
 *   unrelated row.
 * - New names must be safe, distinct from every existing same-locale name and
 *   alias, and written in the record's source-locale script. An exact
 *   same-locale collision becomes a safe reuse. Cross-locale semantic
 *   equivalence remains a model decision; string equality alone is not identity.
 * - Total assignments are clamped to the 0-3 product limit, reuses first.
 * - `outcome` is downgraded when the model's selected actions no longer support
 *   it, so the persisted result can never claim a decision it did not apply.
 * - Nothing is created, merged, renamed, or deleted here.
 */
export function validatePublicClassificationDecision(
  decision: PublicClassificationDecision,
  candidates: PublicCategory[],
  sourceLocale: Locale,
): ValidatedPublicClassificationDecision {
  if (decision.outcome === 'NO_MATCH' || decision.outcome === 'NEEDS_REVIEW') {
    return { outcome: decision.outcome, reuse: [], create: [] };
  }

  const candidateIds = new Set(candidates.map((category) => category.id));
  const existingNameOwners = collectExistingCategoryNameOwners(candidates, sourceLocale);

  const reuse: PublicClassificationReuse[] = [];
  const seenReuseIds = new Set<string>();
  for (const item of decision.reuse) {
    if (!candidateIds.has(item.categoryId) || seenReuseIds.has(item.categoryId)) continue;
    seenReuseIds.add(item.categoryId);
    reuse.push(item);
    if (reuse.length >= PUBLIC_CATEGORY_ASSIGNMENT_LIMIT) break;
  }

  const create: PublicClassificationCreate[] = [];
  const seenCreateNames = new Set<string>();
  if (reuse.length < PUBLIC_CATEGORY_ASSIGNMENT_LIMIT && decision.outcome === 'CREATE') {
    for (const item of decision.create) {
      if (reuse.length + create.length >= PUBLIC_CATEGORY_ASSIGNMENT_LIMIT) break;
      const name = normalizeNewCategoryName(item.name);
      if (name === null || !matchesLocaleScript(name, sourceLocale)) continue;
      const normalized = normalizePublicCategoryName(name);
      const ownerId = existingNameOwners.get(normalized);
      if (ownerId) {
        if (candidateIds.has(ownerId) && !seenReuseIds.has(ownerId)) {
          seenReuseIds.add(ownerId);
          reuse.push({ categoryId: ownerId, rationale: item.rationale });
        }
        continue;
      }
      if (seenCreateNames.has(normalized)) continue;
      seenCreateNames.add(normalized);
      create.push({ ...item, name });
    }
  }

  const total = reuse.length + create.length;
  if (total > PUBLIC_CATEGORY_ASSIGNMENT_LIMIT) {
    create.splice(Math.max(0, PUBLIC_CATEGORY_ASSIGNMENT_LIMIT - reuse.length));
  }

  if (decision.outcome === 'REUSE') {
    return reuse.length > 0 ? { outcome: 'REUSE', reuse, create: [] } : { outcome: 'NO_MATCH', reuse: [], create: [] };
  }
  if (create.length === 0) {
    return reuse.length > 0 ? { outcome: 'REUSE', reuse, create: [] } : { outcome: 'NO_MATCH', reuse: [], create: [] };
  }
  return { outcome: 'CREATE', reuse, create };
}

export type ValidatedPublicCategoryTranslation = { locale: Locale; name: string };

/**
 * Revalidate translation output for the requested missing locales only. Unknown
 * locales, unsafe or script-mismatched names, duplicates, and names already owned
 * by another category in the same locale are dropped rather than overwriting a
 * protected label or colliding with a unique constraint.
 */
export function validatePublicCategoryTranslations(
  output: PublicCategoryTranslationOutput,
  targetLocales: Locale[],
  takenNormalizedNamesByLocale: Map<string, Set<string>>,
): ValidatedPublicCategoryTranslation[] {
  const targets = new Set<string>(targetLocales);
  const seenLocales = new Set<string>();
  const validated: ValidatedPublicCategoryTranslation[] = [];
  for (const translation of output.translations) {
    if (!targets.has(translation.locale) || seenLocales.has(translation.locale)) continue;
    const name = normalizeNewCategoryName(translation.name);
    if (name === null || !matchesLocaleScript(name, translation.locale)) continue;
    const normalized = normalizePublicCategoryName(name);
    if (takenNormalizedNamesByLocale.get(translation.locale)?.has(normalized)) continue;
    seenLocales.add(translation.locale);
    validated.push({ locale: translation.locale, name });
  }
  return validated;
}
