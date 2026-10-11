import { z } from 'zod';

import { SUPPORTED_LOCALES } from '@gloaming/i18n';
import { PUBLIC_CATEGORY_ASSIGNMENT_LIMIT, PUBLIC_CATEGORY_NAME_MAX_CHARS } from '@gloaming/shared/discovery';

/**
 * The only four public classification decisions. `NO_MATCH` is surfaced to
 * Discover as `NO_CATEGORY`; it is not a fifth decision value.
 */
export const PUBLIC_CLASSIFICATION_OUTCOMES = ['REUSE', 'CREATE', 'NO_MATCH', 'NEEDS_REVIEW'] as const;
export type PublicClassificationOutcome = (typeof PUBLIC_CLASSIFICATION_OUTCOMES)[number];

/**
 * Public classification always runs on the instance provider and shares one
 * fixed daily call budget with public category label translation. The value is a
 * call reservation, not a per-record quota.
 */
export const PUBLIC_CLASSIFICATION_DAILY_RESERVATION_LIMIT = 50 as const;

/** A transient AI failure is retried at most this many times before deferring. */
export const PUBLIC_CLASSIFICATION_MAX_ATTEMPTS = 2 as const;

/** Upper bound on category candidates sent to the model, to keep the prompt bounded. */
export const PUBLIC_CLASSIFICATION_MAX_CATEGORY_CANDIDATES = 400 as const;

const rationaleSchema = z.string().trim().min(1).max(240);

/** One existing public category the model judged applicable to the record. */
export const publicClassificationReuseSchema = z.object({
  categoryId: z.string().trim().min(1).max(120),
  /** Concise evidence-backed reason this existing concept applies. */
  rationale: rationaleSchema,
});
export type PublicClassificationReuse = z.infer<typeof publicClassificationReuseSchema>;

/**
 * One proposed new public category. `reusable` and `distinctFromExisting` are
 * literal `true` so a model cannot return a one-book or duplicate concept. The
 * category is always created in the record's source locale; translation to the
 * other supported locales is a separate, explicitly callable operation.
 */
export const publicClassificationCreateSchema = z.object({
  name: z.string().trim().min(1).max(PUBLIC_CATEGORY_NAME_MAX_CHARS),
  /** Concise scope/meaning used later for candidate retrieval. */
  meaning: z.string().trim().min(1).max(240),
  reusable: z.literal(true),
  distinctFromExisting: z.literal(true),
  rationale: rationaleSchema,
});
export type PublicClassificationCreate = z.infer<typeof publicClassificationCreateSchema>;

/**
 * Structured public classification decision. Decision A (concept equivalence)
 * and decision B (book applicability) are separate in the prompt; the decision
 * lists concrete reuses and creates rather than a single opaque label.
 */
export const publicClassificationDecisionSchema = z
  .object({
    outcome: z.enum(PUBLIC_CLASSIFICATION_OUTCOMES),
    reuse: z.array(publicClassificationReuseSchema).max(PUBLIC_CATEGORY_ASSIGNMENT_LIMIT),
    create: z.array(publicClassificationCreateSchema).max(PUBLIC_CATEGORY_ASSIGNMENT_LIMIT),
    /** Required when `outcome` is `NEEDS_REVIEW`; null otherwise. */
    reviewReason: z.string().trim().min(1).max(240).nullable(),
  })
  .superRefine((decision, context) => {
    const total = decision.reuse.length + decision.create.length;
    if (total > PUBLIC_CATEGORY_ASSIGNMENT_LIMIT) {
      context.addIssue({
        code: 'custom',
        message: `At most ${PUBLIC_CATEGORY_ASSIGNMENT_LIMIT} public categories may be selected`,
      });
    }
    if (decision.outcome === 'NO_MATCH' || decision.outcome === 'NEEDS_REVIEW') {
      if (total > 0) {
        context.addIssue({ code: 'custom', message: `${decision.outcome} must not select any category` });
      }
    }
    if (decision.outcome === 'REUSE' && (decision.reuse.length === 0 || decision.create.length > 0)) {
      context.addIssue({ code: 'custom', message: 'REUSE requires at least one reuse and no creation' });
    }
    if (decision.outcome === 'CREATE' && decision.create.length === 0) {
      context.addIssue({ code: 'custom', message: 'CREATE requires at least one proposed category' });
    }
    if (decision.outcome === 'NEEDS_REVIEW' && decision.reviewReason === null) {
      context.addIssue({ code: 'custom', message: 'NEEDS_REVIEW requires a reason' });
    }
  });
export type PublicClassificationDecision = z.infer<typeof publicClassificationDecisionSchema>;

/**
 * Structured translation output for one public category. Only locales that are
 * currently missing are requested, and each returned locale is revalidated.
 */
export const publicCategoryTranslationSchema = z.object({
  translations: z
    .array(
      z.object({
        locale: z.enum(SUPPORTED_LOCALES),
        name: z.string().trim().min(1).max(PUBLIC_CATEGORY_NAME_MAX_CHARS),
      }),
    )
    .max(SUPPORTED_LOCALES.length),
});
export type PublicCategoryTranslationOutput = z.infer<typeof publicCategoryTranslationSchema>;

export const PUBLIC_CLASSIFICATION_DEFERRED_REASONS = [
  'busy',
  'provider_unavailable',
  'budget_unavailable',
  'transient_failure',
] as const;
export type PublicClassificationDeferredReason = (typeof PUBLIC_CLASSIFICATION_DEFERRED_REASONS)[number];

export const PUBLIC_CLASSIFICATION_SKIPPED_REASONS = [
  'source_record_not_found',
  'source_record_not_eligible',
  'candidate_limit_exceeded',
  'input_limit_exceeded',
] as const;
export type PublicClassificationSkippedReason = (typeof PUBLIC_CLASSIFICATION_SKIPPED_REASONS)[number];

/**
 * Deterministic result of one public classification pass. `deferred` means the
 * caller should retry later: nothing is permanently dropped. `skipped` means the
 * record is not a valid target until its eligibility changes.
 */
export type PublicClassificationCommandResult =
  | {
      status: 'completed';
      outcome: PublicClassificationOutcome;
      /** Effective public category ids for the record after this pass (0-3). */
      categoryIds: string[];
      /** Newly created category ids from this pass, for observability. */
      createdCategoryIds: string[];
    }
  | { status: 'deferred'; reason: PublicClassificationDeferredReason }
  | { status: 'skipped'; reason: PublicClassificationSkippedReason };

export type PublicCategoryTranslationResult =
  | { status: 'completed'; categoryId: string; translatedLocales: string[] }
  | { status: 'deferred'; reason: PublicClassificationDeferredReason }
  | { status: 'skipped'; reason: 'category_not_found' | 'no_missing_locales' };
