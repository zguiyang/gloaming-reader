import { randomUUID } from 'node:crypto';

import { type Locale, resolveLocale, SUPPORTED_LOCALES } from '@gloaming/i18n';
import {
  normalizePublicCategoryName,
  PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
  type PublicCategory,
} from '@gloaming/shared/discovery';

import { invokeAi } from '@/domains/ai';
import {
  PUBLIC_CLASSIFICATION_MAX_ATTEMPTS,
  PUBLIC_CLASSIFICATION_MAX_CATEGORY_CANDIDATES,
  type PublicCategoryTranslationOutput,
  type PublicCategoryTranslationResult,
  publicCategoryTranslationSchema,
  type PublicClassificationCommandResult,
  type PublicClassificationDecision,
  publicClassificationDecisionSchema,
  type PublicClassificationDeferredReason,
} from '@/domains/discovery/categories/classification-contract';
import {
  buildPublicCategoryTranslationMessages,
  buildPublicClassificationMessages,
  type ClassifiableSourceRecord,
  publicClassificationInputWithinLimit,
  serializePublicClassificationUserContext,
} from '@/domains/discovery/categories/classification-prompt';
import {
  applyPublicCategoryAssignments,
  insertAiCategoryWithLabel,
  listOtherLabelNormalizedNamesByLocale,
  listPublicCategoryCandidates,
  loadClassifiableSourceRecord,
  loadPublicCategoryTranslationSource,
  upsertAiCategoryLabel,
} from '@/domains/discovery/categories/classification-repository';
import {
  type ValidatedPublicClassificationDecision,
  validatePublicCategoryTranslations,
  validatePublicClassificationDecision,
} from '@/domains/discovery/categories/classification-validation';
import { findCategoryIdByNormalizedLabel } from '@/domains/discovery/categories/repository';
import { resolveInstanceAppSettingValue } from '@/domains/provider-scope';
import { acquireLock, releaseLock, startLockRenewal } from '@/infra/cache/lock';
import { rootLogger } from '@/infra/logging/logger';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

/** One instance-wide lock so only a single public classification/translation task runs at a time. */
const PUBLIC_CLASSIFICATION_LOCK_KEY = 'gloaming:public-classification:instance';
const logger = rootLogger.child({ module: 'PublicCategoryTranslation' });
const PUBLIC_CLASSIFICATION_LOCK_SECONDS = 90;
const PUBLIC_CLASSIFICATION_LOCK_MAX_MS = 120_000;
const AI_TIMEOUT_MS = 25_000;
const AI_OUTPUT_TOKEN_LIMIT = 1_200;
const AI_TRANSLATION_OUTPUT_TOKEN_LIMIT = 800;

function isModelNotConfigured(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.AI.MODEL_NOT_CONFIGURED;
}

type InvokeOutcome<T> =
  { status: 'ok'; content: T } | { status: 'deferred'; reason: PublicClassificationDeferredReason };

/**
 * Invoke once and retry a transient failure at most once more. A provider that is
 * unavailable defers without dropping the work; any other failure is retried up to
 * the bounded attempt limit before deferring as a transient failure.
 */
async function invokeWithRetries<T>(invoke: () => Promise<T>): Promise<InvokeOutcome<T>> {
  for (let attempt = 0; attempt < PUBLIC_CLASSIFICATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return { status: 'ok', content: await invoke() };
    } catch (error) {
      if (isModelNotConfigured(error)) return { status: 'deferred', reason: 'provider_unavailable' };
    }
  }
  return { status: 'deferred', reason: 'transient_failure' };
}

function toClassifiableRecord(
  record: Awaited<ReturnType<typeof loadClassifiableSourceRecord>>,
): ClassifiableSourceRecord {
  if (!record) throw new Error('SourceRecord evidence is required');
  return {
    id: record.id,
    title: record.title,
    authors: record.authors.map((author) => author.name),
    languages: record.languages,
    description: record.description,
    subjects: record.sourceMeta.subjects ?? [],
    bookshelves: record.sourceMeta.bookshelves ?? [],
  };
}

async function resolveNewPublicCategory(input: {
  name: string;
  normalizedName: string;
  meaning: string;
  locale: Locale;
}): Promise<{ id: string; created: boolean }> {
  const existingId = await findCategoryIdByNormalizedLabel(input.locale, input.normalizedName);
  if (existingId) return { id: existingId, created: false };
  return insertAiCategoryWithLabel(input);
}

/**
 * Persist a validated decision: reuse existing stable ids and create only the
 * approved new concepts, resolving an exact name collision to the existing id.
 * Raw `sourceMeta` is never written. The shared assignment policy preserves
 * manual assignments and suppression and enforces the 0-3 limit. Every outcome
 * except a review abstention reconciles the record's AI associations to this
 * pass inside one locked transaction, so stale AI rows are removed while manual
 * rows and suppression memory survive; `categoryIds` reports the associations
 * the record actually carries afterwards.
 */
async function persistPublicClassificationDecision(
  recordId: string,
  decision: ValidatedPublicClassificationDecision,
  candidates: PublicCategory[],
  sourceLocale: Locale,
): Promise<{ categoryIds: string[]; createdCategoryIds: string[] }> {
  const candidateIds = new Set(candidates.map((category) => category.id));
  const orderedIds: string[] = [];
  for (const reuse of decision.reuse) {
    if (candidateIds.has(reuse.categoryId) && !orderedIds.includes(reuse.categoryId)) {
      orderedIds.push(reuse.categoryId);
    }
  }

  const createdCategoryIds: string[] = [];
  for (const create of decision.create) {
    if (orderedIds.length >= PUBLIC_CATEGORY_ASSIGNMENT_LIMIT) break;
    const resolved = await resolveNewPublicCategory({
      name: create.name,
      normalizedName: normalizePublicCategoryName(create.name),
      meaning: create.meaning,
      locale: sourceLocale,
    });
    if (!orderedIds.includes(resolved.id)) orderedIds.push(resolved.id);
    if (resolved.created) createdCategoryIds.push(resolved.id);
  }

  const categoryIds = await applyPublicCategoryAssignments(
    recordId,
    orderedIds.slice(0, PUBLIC_CATEGORY_ASSIGNMENT_LIMIT),
    { reconcileStaleAi: decision.outcome !== 'NEEDS_REVIEW' },
  );
  return { categoryIds, createdCategoryIds };
}

/**
 * Best-effort first-pass translation for the public categories created by one
 * classification pass. It runs only after the classification lock is released
 * because the translator acquires the same instance lock. Any translation,
 * provider, validation, or persistence failure is reported and never
 * changes the already-persisted classification result or hides the created
 * category.
 */
async function translateCreatedPublicCategories(categoryIds: string[]): Promise<void> {
  for (const categoryId of categoryIds) {
    try {
      await translateMissingPublicCategoryLabels(categoryId);
    } catch (error) {
      logger.warn(
        { err: error, categoryId },
        'Public category label translation failed after classification; the created category is kept',
      );
    }
  }
}

/**
 * Deterministic public classification command.
 *
 * PC-06 usage: after a successful source sync identifies a new or materially
 * changed eligible SourceRecord, call this once per record. Handle the result:
 * `completed` is final for that pass; `deferred` means nothing was dropped and
 * the caller should schedule another call later; `skipped` means the record is
 * not a valid target until its eligibility changes. Do not call at search or
 * render time. The command always resolves the instance provider and never a
 * user BYOK provider, queries only public categories, and never touches User Tags.
 * After releasing the lock it makes a best-effort translation attempt for each
 * newly created category, without changing the completed classification result.
 */
export async function classifySourceRecordForPublicCategories(
  sourceRecordId: string,
): Promise<PublicClassificationCommandResult> {
  const lockToken = randomUUID();
  if (!(await acquireLock(PUBLIC_CLASSIFICATION_LOCK_KEY, lockToken, PUBLIC_CLASSIFICATION_LOCK_SECONDS))) {
    return { status: 'deferred', reason: 'busy' };
  }
  let leaseLost = false;
  const renewal = startLockRenewal(PUBLIC_CLASSIFICATION_LOCK_KEY, lockToken, PUBLIC_CLASSIFICATION_LOCK_SECONDS, {
    maxDurationMs: PUBLIC_CLASSIFICATION_LOCK_MAX_MS,
    onLeaseLost: () => {
      leaseLost = true;
    },
  });
  // Filled only after the decision is persisted, so early returns and failed
  // classification passes never trigger translation.
  let createdCategoryIds: string[] = [];
  try {
    const record = await loadClassifiableSourceRecord(sourceRecordId);
    if (!record) return { status: 'skipped', reason: 'source_record_not_found' };
    if (record.availability !== 'available' || !record.sourceEnabled) {
      return { status: 'skipped', reason: 'source_record_not_eligible' };
    }
    if (!(await resolveInstanceAppSettingValue('assist.default_model_id'))) {
      return { status: 'deferred', reason: 'provider_unavailable' };
    }

    const candidates = await listPublicCategoryCandidates();
    if (candidates.length > PUBLIC_CLASSIFICATION_MAX_CATEGORY_CANDIDATES) {
      return { status: 'skipped', reason: 'candidate_limit_exceeded' };
    }

    const sourceLocale = resolveLocale(record.languages[0]);
    const classifiableRecord = toClassifiableRecord(record);
    const userContext = serializePublicClassificationUserContext(classifiableRecord, candidates, sourceLocale);
    if (!publicClassificationInputWithinLimit(userContext)) {
      return { status: 'skipped', reason: 'input_limit_exceeded' };
    }

    const messages = buildPublicClassificationMessages(classifiableRecord, candidates, sourceLocale);
    const outcome = await invokeWithRetries<PublicClassificationDecision>(async () => {
      const result = await invokeAi({
        purpose: 'assist',
        source: 'public-classification.classify',
        ref: { type: 'source_record', id: sourceRecordId },
        timeoutMs: AI_TIMEOUT_MS,
        maxTokens: AI_OUTPUT_TOKEN_LIMIT,
        maxRetries: 0,
        outputSchema: publicClassificationDecisionSchema,
        messages,
      });
      return result.content;
    });
    if (outcome.status === 'deferred') return outcome;

    const validated = validatePublicClassificationDecision(outcome.content, candidates, sourceLocale);
    if (leaseLost) return { status: 'deferred', reason: 'transient_failure' };

    const persisted = await persistPublicClassificationDecision(record.id, validated, candidates, sourceLocale);
    createdCategoryIds = persisted.createdCategoryIds;
    return {
      status: 'completed',
      outcome: validated.outcome,
      categoryIds: persisted.categoryIds,
      createdCategoryIds: persisted.createdCategoryIds,
    };
  } finally {
    renewal.stop();
    await releaseLock(PUBLIC_CLASSIFICATION_LOCK_KEY, lockToken);
    // The translator acquires the same instance lock, so only translate after release.
    if (createdCategoryIds.length > 0) {
      await translateCreatedPublicCategories(createdCategoryIds);
    }
  }
}

/**
 * Minimal callable AI label-translation operation for PC-05.
 *
 * Fills only the SUPPORTED_LOCALES that are missing a label, using the same
 * instance-only provider as classification. A label with `edited_by = 'manual'`
 * is never overwritten.
 * Manual category creation never calls this, so it is never blocked by a missing
 * provider. PC-05 may call it optionally, and PC-03 triggers it best-effort for
 * each category it created after releasing the classification lock.
 */
export async function translateMissingPublicCategoryLabels(
  categoryId: string,
): Promise<PublicCategoryTranslationResult> {
  const lockToken = randomUUID();
  if (!(await acquireLock(PUBLIC_CLASSIFICATION_LOCK_KEY, lockToken, PUBLIC_CLASSIFICATION_LOCK_SECONDS))) {
    return { status: 'deferred', reason: 'busy' };
  }
  let leaseLost = false;
  const renewal = startLockRenewal(PUBLIC_CLASSIFICATION_LOCK_KEY, lockToken, PUBLIC_CLASSIFICATION_LOCK_SECONDS, {
    maxDurationMs: PUBLIC_CLASSIFICATION_LOCK_MAX_MS,
    onLeaseLost: () => {
      leaseLost = true;
    },
  });
  try {
    const source = await loadPublicCategoryTranslationSource(categoryId);
    if (!source) return { status: 'skipped', reason: 'category_not_found' };

    const presentLocales = new Set(source.labels.map((label) => label.locale));
    const targetLocales = SUPPORTED_LOCALES.filter((locale) => !presentLocales.has(locale));
    if (targetLocales.length === 0) return { status: 'skipped', reason: 'no_missing_locales' };
    if (!(await resolveInstanceAppSettingValue('assist.default_model_id'))) {
      return { status: 'deferred', reason: 'provider_unavailable' };
    }

    const messages = buildPublicCategoryTranslationMessages({
      categoryId: source.id,
      meaning: source.meaning,
      existingLabels: Object.fromEntries(source.labels.map((label) => [label.locale, label.name])),
      aliases: source.aliases,
      targetLocales: [...targetLocales],
    });
    const outcome = await invokeWithRetries<PublicCategoryTranslationOutput>(async () => {
      const result = await invokeAi({
        purpose: 'assist',
        source: 'public-classification.translate',
        ref: { type: 'public_category', id: categoryId },
        timeoutMs: AI_TIMEOUT_MS,
        maxTokens: AI_TRANSLATION_OUTPUT_TOKEN_LIMIT,
        maxRetries: 0,
        outputSchema: publicCategoryTranslationSchema,
        messages,
      });
      return result.content;
    });
    if (outcome.status === 'deferred') return outcome;
    if (leaseLost) return { status: 'deferred', reason: 'transient_failure' };

    const takenNames = await listOtherLabelNormalizedNamesByLocale(categoryId);
    const validated = validatePublicCategoryTranslations(outcome.content, [...targetLocales], takenNames);
    const translatedLocales: string[] = [];
    for (const translation of validated) {
      const applied = await upsertAiCategoryLabel({
        categoryId,
        locale: translation.locale,
        name: translation.name,
        normalizedName: normalizePublicCategoryName(translation.name),
      });
      if (applied) translatedLocales.push(translation.locale);
    }
    return { status: 'completed', categoryId, translatedLocales };
  } finally {
    renewal.stop();
    await releaseLock(PUBLIC_CLASSIFICATION_LOCK_KEY, lockToken);
  }
}
