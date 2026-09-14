/** Stable API error codes — also used as {@link @gloaming/i18n} translation keys. */
export const ERROR_CODES = {
  UNAUTHORIZED: 'api.errors.unauthorized',
  FORBIDDEN: 'api.errors.forbidden',
  INTERNAL_SERVER_ERROR: 'api.errors.internalServerError',
  TOO_MANY_REQUESTS: 'api.errors.tooManyRequests',
  VALIDATION_FAILED: 'api.errors.validationFailed',

  NOT_FOUND: {
    WORK: 'api.errors.notFound.work',
    PART: 'api.errors.notFound.part',
    CONVERSATION: 'api.errors.notFound.conversation',
    READING_STATE: 'api.errors.notFound.readingState',
    LLM_PROVIDER: 'api.errors.notFound.llmProvider',
    LLM_MODEL: 'api.errors.notFound.llmModel',
    PART_AUDIO: 'api.errors.notFound.partAudio',
    CLEANUP_JOB: 'api.errors.notFound.cleanupJob',
    TAXONOMY_TAG: 'api.errors.notFound.taxonomyTag',
    TAXONOMY_CATEGORY: 'api.errors.notFound.taxonomyCategory',
    TAXONOMY_SOURCE: 'api.errors.notFound.taxonomySource',
    WORD_DEFINITION: 'api.errors.notFound.wordDefinition',
  },

  UPLOAD: {
    FILE_TOO_LARGE: 'api.errors.upload.fileTooLarge',
    FILE_REQUIRED: 'api.errors.upload.fileRequired',
    FILE_NAME_REQUIRED: 'api.errors.upload.fileNameRequired',
    INVALID_HASH: 'api.errors.upload.invalidHash',
    UNSUPPORTED_FORMAT: 'api.errors.upload.unsupportedFormat',
    UNSUPPORTED_MIME: 'api.errors.upload.unsupportedMime',
    CONTENT_INVALID: 'api.errors.upload.contentInvalid',
    EPUB_ONLY: 'api.errors.upload.epubOnly',
  },

  WORK: {
    CREATE_FAILED: 'api.errors.work.createFailed',
    CREATE_PART_FAILED: 'api.errors.work.createPartFailed',
    UPLOAD_EPUB_FAILED: 'api.errors.work.uploadEpubFailed',
    RESERVE_PARSE_FAILED: 'api.errors.work.reserveParseFailed',
    PUBLISH_INCOMPLETE: 'api.errors.work.publishIncomplete',
    UNPUBLISH_NOT_PUBLISHED: 'api.errors.work.unpublishNotPublished',
    RETRY_EPUB_ONLY: 'api.errors.work.retryEpubOnly',
    UNPUBLISH_BEFORE_RETRY: 'api.errors.work.unpublishBeforeRetry',
    NO_RETRYABLE_STEPS: 'api.errors.work.noRetryableSteps',
    PROCESSING_IN_PROGRESS: 'api.errors.work.processingInProgress',
    MANUAL_AUDIO_REQUIRED: 'api.errors.work.manualAudioRequired',
    STATE_CHANGED: 'api.errors.work.stateChanged',
    UNPUBLISH_FIRST: 'api.errors.work.unpublishFirst',
  },

  TAXONOMY: {
    INVALID_KIND: 'api.errors.taxonomy.invalidKind',
    CLEANUP_KIND_ONLY: 'api.errors.taxonomy.cleanupKindOnly',
    SOURCE_DELETE_FORBIDDEN: 'api.errors.taxonomy.sourceDeleteForbidden',
    TAG_NAME_EXISTS: 'api.errors.taxonomy.tag.nameExists',
    CATEGORY_NAME_EXISTS: 'api.errors.taxonomy.category.nameExists',
    SOURCE_NAME_EXISTS: 'api.errors.taxonomy.source.nameExists',
    TAG_NAME_CONFLICT: 'api.errors.taxonomy.tag.nameConflict',
    CATEGORY_NAME_CONFLICT: 'api.errors.taxonomy.category.nameConflict',
    SOURCE_NAME_CONFLICT: 'api.errors.taxonomy.source.nameConflict',
    TAG_IN_USE: 'api.errors.taxonomy.tag.inUse',
    CATEGORY_IN_USE: 'api.errors.taxonomy.category.inUse',
    SOURCE_IN_USE: 'api.errors.taxonomy.source.inUse',
  },

  TTS: {
    API_KEY_REQUIRED: 'api.errors.tts.apiKeyRequired',
    NOT_CONFIGURED: 'api.errors.tts.notConfigured',
    DISABLED: 'api.errors.tts.disabled',
    UNSUPPORTED_PROVIDER: 'api.errors.tts.unsupportedProvider',
    TEXT_REQUIRED: 'api.errors.tts.textRequired',
    INVALID_CREDENTIALS: 'api.errors.tts.invalidCredentials',
    SYNTHESIS_FAILED: 'api.errors.tts.synthesisFailed',
  },

  AI: {
    UNAVAILABLE: 'api.errors.ai.unavailable',
    MODEL_NOT_CONFIGURED: 'api.errors.ai.modelNotConfigured',
  },

  LLM: {
    FAMILY_NOT_IMPLEMENTED: 'api.errors.llm.familyNotImplemented',
    UNKNOWN_API_FAMILY: 'api.errors.llm.unknownApiFamily',
    THINKING_NOT_SUPPORTED: 'api.errors.llm.thinkingNotSupported',
    WIRE_VARIANT_INVALID: 'api.errors.llm.wireVariantInvalid',
    MODEL_ID_EXISTS: 'api.errors.llm.modelIdExists',
    MODEL_REFERENCED: 'api.errors.llm.modelReferenced',
    UNKNOWN_SETTING_KEY: 'api.errors.llm.unknownSettingKey',
    MODEL_OR_PROVIDER_DISABLED: 'api.errors.llm.modelOrProviderDisabled',
    PROVIDER_DISABLED: 'api.errors.llm.providerDisabled',
    NO_ENABLED_MODEL: 'api.errors.llm.noEnabledModel',
    API_KEY_DECRYPT_FAILED: 'api.errors.llm.apiKeyDecryptFailed',
    INVALID_API_FAMILY: 'api.errors.llm.invalidApiFamily',
    MODEL_LIST_NOT_SUPPORTED: 'api.errors.llm.modelListNotSupported',
    MODEL_LIST_FETCH_FAILED: 'api.errors.llm.modelListFetchFailed',
  },

  OUTBOUND_URL: {
    INVALID: 'api.errors.outboundUrl.invalid',
    SCHEME: 'api.errors.outboundUrl.scheme',
    CREDENTIALS: 'api.errors.outboundUrl.credentials',
    PRIVATE_NETWORK: 'api.errors.outboundUrl.privateNetwork',
  },

  OSS: {
    NOT_CONFIGURED: 'api.errors.oss.notConfigured',
    UNAVAILABLE: 'api.errors.oss.unavailable',
  },

  DICTIONARY: {
    PROVIDER_NOT_IMPLEMENTED: 'api.errors.dictionary.providerNotImplemented',
    PROVIDER_SAVE_NOT_SUPPORTED: 'api.errors.dictionary.providerSaveNotSupported',
    QUERY_DISABLED: 'api.errors.dictionary.queryDisabled',
    UPSTREAM_ERROR: 'api.errors.dictionary.upstreamError',
    REQUEST_TIMEOUT: 'api.errors.dictionary.requestTimeout',
    FETCH_FAILED: 'api.errors.dictionary.fetchFailed',
    TRANSPORT_FAILURE: 'api.errors.dictionary.transportFailure',
    INVALID_JSON: 'api.errors.dictionary.invalidJson',
    MALFORMED_RESPONSE: 'api.errors.dictionary.malformedResponse',
    PAYLOAD_FAILURE: 'api.errors.dictionary.payloadFailure',
  },

  CONVERSATION: {
    MISMATCH_SURFACE: 'api.errors.conversation.mismatchSurface',
    MISMATCH_WORK: 'api.errors.conversation.mismatchWork',
  },

  CONTENT_ASSET: {
    NO_TEXT_TO_SYNTHESIZE: 'api.errors.contentAsset.noTextToSynthesize',
    PART_NOT_IN_WORK: 'api.errors.contentAsset.partNotInWork',
  },

  ASSET_MANAGEMENT: {
    SCAN_SNAPSHOT_EXPIRED: 'api.errors.assetManagement.scanSnapshotExpired',
    SCAN_INCOMPLETE: 'api.errors.assetManagement.scanIncomplete',
    NO_ORPHANS: 'api.errors.assetManagement.noOrphans',
    SCAN_IN_PROGRESS: 'api.errors.assetManagement.scanInProgress',
    CLEANUP_ALREADY_COMPLETED: 'api.errors.assetManagement.cleanupAlreadyCompleted',
    CLEANUP_RETRY_EXISTING: 'api.errors.assetManagement.cleanupRetryExisting',
    CLEANUP_JOB_NOT_FOUND: 'api.errors.assetManagement.cleanupJobNotFound',
    NO_FAILED_OBJECTS: 'api.errors.assetManagement.noFailedObjects',
  },

  READER: {
    REVISION_CONFLICT: 'api.errors.reader.revisionConflict',
    NO_NEXT_CHAPTER: 'api.errors.reader.noNextChapter',
    UNSUPPORTED_ACTION: 'api.errors.reader.unsupportedAction',
  },
} as const;

type DeepStringValues<T> = T extends string ? T : { [K in keyof T]: DeepStringValues<T[K]> }[keyof T];

export type ErrorCode = DeepStringValues<typeof ERROR_CODES>;
