export { classifySourceRecordForPublicCategories, translateMissingPublicCategoryLabels } from './classification';
export type {
  PublicCategoryTranslationOutput,
  PublicCategoryTranslationResult,
  PublicClassificationCommandResult,
  PublicClassificationCreate,
  PublicClassificationDecision,
  PublicClassificationDeferredReason,
  PublicClassificationOutcome,
  PublicClassificationReuse,
  PublicClassificationSkippedReason,
} from './classification-contract';
export {
  PUBLIC_CLASSIFICATION_DEFERRED_REASONS,
  PUBLIC_CLASSIFICATION_MAX_ATTEMPTS,
  PUBLIC_CLASSIFICATION_MAX_CATEGORY_CANDIDATES,
  PUBLIC_CLASSIFICATION_OUTCOMES,
  PUBLIC_CLASSIFICATION_SKIPPED_REASONS,
  publicCategoryTranslationSchema,
  publicClassificationCreateSchema,
  publicClassificationDecisionSchema,
  publicClassificationReuseSchema,
} from './classification-contract';
export type { ValidatedPublicClassificationDecision } from './classification-validation';
export { validatePublicCategoryTranslations, validatePublicClassificationDecision } from './classification-validation';
export type {
  PublicClassificationEvidence,
  PublicClassificationEvidenceCandidate,
  PublicClassificationVerdict,
} from './incremental-classification';
export {
  completePublicClassification,
  computePublicClassificationFingerprint,
  deferPublicClassification,
  dispatchDuePublicClassifications,
  getPublicClassificationVerdict,
  JOB_PUBLIC_CLASSIFICATION,
  PUBLIC_CLASSIFICATION_DISPATCH_BATCH_LIMIT,
  recordPublicClassificationEvidenceBatch,
  resolvePublicClassificationRetryAt,
} from './incremental-classification';
export {
  decideCategoryAssignment,
  shouldSuppressOnRemoval,
  toPublicCategoryListItem,
  toPublicCategoryManagementItem,
} from './policy';
export {
  assignCategoryToSourceRecord,
  completeManagedCategoryTranslations,
  createManagedCategory,
  deleteManagedCategory,
  getPublicCategory,
  listManagedCategories,
  listManagedCategorySourceRecords,
  listPublicCategories,
  unassignCategoryFromSourceRecord,
  updateManagedCategoryLabel,
} from './service';
export { acceptShelfCategoryProposal, organizeUnassignedCategoryShelves } from './shelf-organization';
export {
  attachShelfTermsToCategories,
  detachCategoryShelfLinks,
  listGutenbergCategoryShelfTerms,
  recomputeAllRecordsForConfirmedShelves,
  saveCategoryShelfTerms,
} from './shelf-terms-admin';
export {
  confirmNewSourceCategory,
  confirmSourceCategoryMapping,
  GUTENBERG_CATEGORY_BOOKSHELF_PREFIX,
  ignoreSourceCategoryMapping,
  isGutenbergCategoryBookshelf,
  listSourceCategoryMappings,
  normalizeSourceCategory,
  reconcileSourceCategoryAssignments,
  registerSourceCategoryTerms,
  runSourceCategoryReconciliationBatch,
  suggestSourceCategoryMapping,
} from './source-category-mapping';
