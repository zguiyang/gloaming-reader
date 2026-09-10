import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Better Auth core tables (PostgreSQL) + username plugin / product fields. */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  /** Username plugin (normalized, unique). */
  username: text('username').unique(),
  /** Username plugin (display form as entered). */
  displayUsername: text('display_username'),
  /** Product role — server-default `user`; never client-settable via BA input. */
  role: text('role').default('user').notNull(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

/** Provenance of a work-dimension association (rules / AI / manual). */
export type WorkMetadataProvenance = 'extracted' | 'ai' | 'manual';

/** Work-level reading stats provenance — algorithm from parse vs admin manual override. */
export type WorkStatsProvenance = 'algorithm' | 'manual';

/** Runtime-derived admin API projection — not persisted on reading_work. */
export type WorkMetadataProvenanceMap = {
  description?: WorkMetadataProvenance;
  tags?: WorkMetadataProvenance;
  category?: WorkMetadataProvenance;
};

/** Reading catalog root — metadata only, no body (ADR-001). */
export const readingWork = pgTable(
  'reading_work',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    author: text('author').notNull().default(''),
    description: text('description').notNull().default(''),
    language: text('language').notNull().default('en'),
    status: text('status').notNull().default('processing'),
    visibility: text('visibility').notNull().default('catalog'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    originKind: text('origin_kind').notNull().default('admin_text'),
    originMeta: jsonb('origin_meta').$type<Record<string, unknown>>().notNull().default({}),
    descriptionProvenance: text('description_provenance').$type<WorkMetadataProvenance | null>(),
    coverAssetId: text('cover_asset_id'),
    /** Running word tokens (not unique lemmas) — set on content parse. */
    wordCount: integer('word_count'),
    estimatedMinutes: integer('estimated_minutes'),
    /** Minimum lemma vocabulary for ~95% lexical coverage (English works). */
    suggestedVocabSize: integer('suggested_vocab_size'),
    difficultyScore: integer('difficulty_score'),
    statsProvenance: text('stats_provenance').$type<WorkStatsProvenance | null>(),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('reading_work_status_idx').on(table.status),
    index('reading_work_published_at_idx').on(table.publishedAt),
  ],
);

/** Shared dimension: tag (unique by normalized form — reuse-first). */
export const tag = pgTable(
  'tag',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    normalized: text('normalized').notNull().unique(),
    /** Who first created this row — never rewritten on reuse/rename. */
    origin: text('origin').$type<WorkMetadataProvenance>().notNull().default('manual'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('tag_normalized_idx').on(table.normalized)],
);

/** Shared dimension: category (predefined enumeration, admin-extendable). */
export const category = pgTable(
  'category',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    normalized: text('normalized').notNull().unique(),
    /** Who first created this row — never rewritten on reuse/rename. */
    origin: text('origin').$type<WorkMetadataProvenance>().notNull().default('manual'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('category_normalized_idx').on(table.normalized)],
);

/** Shared dimension: source (match_rule = domain / keyword used against dc:source). */
export const source = pgTable(
  'source',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    matchRule: text('match_rule').notNull().default(''),
    /** Who first created this row — never rewritten on reuse/rename. */
    origin: text('origin').$type<WorkMetadataProvenance>().notNull().default('manual'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('source_match_rule_idx').on(table.matchRule)],
);

export const readingWorkTag = pgTable(
  'reading_work_tag',
  {
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
    provenance: text('provenance').$type<WorkMetadataProvenance>().notNull().default('extracted'),
  },
  (table) => [
    unique('reading_work_tag_work_tag_uidx').on(table.workId, table.tagId),
    index('reading_work_tag_work_idx').on(table.workId),
    index('reading_work_tag_tag_idx').on(table.tagId),
  ],
);

export const readingWorkCategory = pgTable(
  'reading_work_category',
  {
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'cascade' }),
    provenance: text('provenance').$type<WorkMetadataProvenance>().notNull().default('extracted'),
  },
  (table) => [
    unique('reading_work_category_work_category_uidx').on(table.workId, table.categoryId),
    index('reading_work_category_work_idx').on(table.workId),
    index('reading_work_category_category_idx').on(table.categoryId),
  ],
);

export const readingWorkSource = pgTable(
  'reading_work_source',
  {
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    provenance: text('provenance').$type<WorkMetadataProvenance>().notNull().default('extracted'),
  },
  (table) => [
    unique('reading_work_source_work_source_uidx').on(table.workId, table.sourceId),
    index('reading_work_source_work_idx').on(table.workId),
    index('reading_work_source_source_idx').on(table.sourceId),
  ],
);

/** Ordered readable unit — SSOT for Reader, TTS, Translate, Assist. */
export const readingPart = pgTable(
  'reading_part',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    kind: text('kind').notNull().default('body'),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('reading_part_work_sort_uidx').on(table.workId, table.sortOrder),
    index('reading_part_work_idx').on(table.workId),
  ],
);

/** User × work shelf membership and reading position (ADR-001). */
export const readingState = pgTable(
  'reading_state',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    currentPartId: text('current_part_id').references(() => readingPart.id, { onDelete: 'set null' }),
    /** Highest sortOrder among fully read parts; -1 = none. Replaces scroll anchor for progress. */
    completedThroughSortOrder: integer('completed_through_sort_order').notNull().default(-1),
    /** Monotonic row revision for compare-and-swap state updates. */
    revision: integer('revision').notNull().default(0),
    anchorKind: text('anchor_kind'),
    anchorValue: text('anchor_value'),
    status: text('status').notNull().default('in_progress'),
    addedAt: timestamp('added_at').defaultNow().notNull(),
    lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('reading_state_user_work_uidx').on(table.userId, table.workId),
    check('reading_state_revision_nonnegative_chk', sql`${table.revision} >= 0`),
    index('reading_state_user_last_read_idx').on(table.userId, table.lastReadAt),
    index('reading_state_work_idx').on(table.workId),
  ],
);

export const readingWorkRelations = relations(readingWork, ({ many }) => ({
  parts: many(readingPart),
  states: many(readingState),
}));

export const readingPartRelations = relations(readingPart, ({ one }) => ({
  work: one(readingWork, {
    fields: [readingPart.workId],
    references: [readingWork.id],
  }),
}));

export const readingStateRelations = relations(readingState, ({ one }) => ({
  user: one(user, {
    fields: [readingState.userId],
    references: [user.id],
  }),
  work: one(readingWork, {
    fields: [readingState.workId],
    references: [readingWork.id],
  }),
  currentPart: one(readingPart, {
    fields: [readingState.currentPartId],
    references: [readingPart.id],
  }),
}));

/** LLM gateway credentials (API key encrypted at rest); one row per API family instance. */
export const llmProvider = pgTable('llm_provider', {
  id: text('id').primaryKey(),
  /** Wire API family for this provider; immutable after create. See `@gloaming/shared/llm`. */
  apiFamily: text('api_family').notNull().default('openai'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  /** Optional outbound proxy (http/https/socks5 URI) for reachability-gated gateways. */
  proxyUrl: text('proxy_url'),
  /** Provider-specific thinking-toggle parameter name (e.g. `enable_thinking`); empty = pass nothing. */
  thinkingParam: text('thinking_param'),
  /** Balance query endpoint (absolute URL or `/`-relative path). Empty = balance query disabled. */
  balanceEndpoint: text('balance_endpoint'),
  /** JSON path to the balance amount in the balance endpoint response (e.g. `data.available_balance`). */
  balanceAmountPath: text('balance_amount_path'),
  /** JSON path to the currency in the balance response; empty = `USD`. */
  balanceCurrencyPath: text('balance_currency_path'),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/** Callable model under a provider (upstream model id + tuning). */
export const llmModel = pgTable(
  'llm_model',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => llmProvider.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    label: text('label').notNull(),
    /** Family-scoped wire variant (see wire-registry SSOT). */
    wireVariant: text('wire_variant').notNull().default('chat-completions'),
    /** Model context window in tokens (informational; from provider model list when available). */
    contextLength: integer('context_length'),
    temperature: doublePrecision('temperature'),
    maxTokens: integer('max_tokens'),
    isEnabled: boolean('is_enabled').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('llm_model_provider_model_uidx').on(table.providerId, table.modelId),
    index('llm_model_provider_idx').on(table.providerId),
  ],
);

/** App-level purpose → default model binding (e.g. assist.default_model_id). */
export const llmAppSetting = pgTable('llm_app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/** Singleton Azure TTS credentials + default / accent voice bindings. */
export const ttsConfig = pgTable('tts_config', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('azure'),
  region: text('region').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  defaultVoice: text('default_voice').notNull(),
  usVoice: text('us_voice').notNull(),
  ukVoice: text('uk_voice').notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/** Singleton Dictionary configuration + provider settings. */
export const dictionaryConfig = pgTable('dictionary_config', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('free_dictionary'),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  enableAiEnrichment: boolean('enable_ai_enrichment').default(true).notNull(),
  customEndpoint: text('custom_endpoint'),
  apiKeyCiphertext: text('api_key_ciphertext'),
  timeoutMs: integer('timeout_ms').default(5000).notNull(),
  cacheTtlDays: integer('cache_ttl_days').default(30).notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export type DictionaryPhoneticItem = {
  text?: string;
  audio?: string;
  sourceUrl?: string;
  role?: 'us' | 'uk' | 'general';
};

export type DictionaryDefinitionItem = {
  definition: string;
  definitionZh?: string;
  example?: string;
  exampleZh?: string;
  synonyms?: string[];
  antonyms?: string[];
};

export type DictionaryMeaningItem = {
  partOfSpeech: string;
  definitions: DictionaryDefinitionItem[];
  synonyms?: string[];
  antonyms?: string[];
};

export type DictionaryContextExampleItem = {
  sentence: string;
  sentenceZh?: string;
  note?: string;
  workId?: string;
  partId?: string;
  workTitle?: string;
};

/** Persisted dictionary words with phonetic, meanings, and contextual examples (L2 Cache). */
export const dictionaryEntry = pgTable(
  'dictionary_entry',
  {
    id: text('id').primaryKey(),
    word: text('word').notNull(),
    phonetics: jsonb('phonetics').$type<DictionaryPhoneticItem[]>().notNull().default([]),
    meanings: jsonb('meanings').$type<DictionaryMeaningItem[]>().notNull().default([]),
    contextExamples: jsonb('context_examples').$type<DictionaryContextExampleItem[]>().notNull().default([]),
    rawProviderData: jsonb('raw_provider_data'),
    source: text('source').notNull().default('free_dictionary'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [unique('dictionary_entry_word_uidx').on(table.word), index('dictionary_entry_word_idx').on(table.word)],
);

/** Word boundary timings for part audio (mirrors TTS wordTimings). */
export type ContentAssetWordTiming = {
  text: string;
  audioOffsetMs: number;
  durationMs: number;
  textOffset: number;
};

/** One TTS segment inside a part audio timeline (audio_* kinds). */
export type ContentAssetAudioTimelineSegment = {
  index: number;
  textHash: string;
  startMs: number;
  durationMs: number;
  /**
   * Legacy segment object key. New chapter-only assets omit this and keep
   * timing fields only; historical rows may still include it.
   */
  storageKey?: string;
  wordTimings: ContentAssetWordTiming[];
};

export type ContentAssetMeta = {
  voice?: string;
  durationMs?: number;
  lastError?: string;
  generatedAt?: string;
  /** audio_* — word-timing segments (`storageKey` optional / timing-only). */
  timeline?: ContentAssetAudioTimelineSegment[];
  /**
   * Formal persisted object-storage keys only (e.g. chapter.mp3).
   * Do not list ephemeral or never-persisted segment keys.
   */
  objectKeys?: string[];
  /** Origin file uploads (kind = origin_file). */
  originalFileName?: string;
  size?: number;
  /** Original path inside the source EPUB (image / cover assets). */
  originalPath?: string;
  /** True when the upload reused an already-stored object (dedupe / instant upload). */
  reused?: boolean;
};

/** Unified storage for origin files, covers, TTS audio, future derivatives (ADR-001). */
export const contentAsset = pgTable(
  'content_asset',
  {
    id: text('id').primaryKey(),
    workId: text('work_id').references(() => readingWork.id, { onDelete: 'cascade' }),
    partId: text('part_id').references(() => readingPart.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    contentHash: text('content_hash').notNull(),
    /** Stable part/kind/content identity used to claim one generation. */
    generationKey: text('generation_key'),
    /** Opaque backend-owned claim token; never expose through learner APIs. */
    generationToken: text('generation_token'),
    generationClaimedAt: timestamp('generation_claimed_at'),
    generationLeaseExpiresAt: timestamp('generation_lease_expires_at'),
    meta: jsonb('meta').$type<ContentAssetMeta>().notNull().default({}),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('content_asset_part_kind_uidx').on(table.partId, table.kind),
    uniqueIndex('content_asset_generation_key_uidx')
      .on(table.generationKey)
      .where(sql`${table.generationKey} is not null`),
    uniqueIndex('content_asset_generation_token_uidx')
      .on(table.generationToken)
      .where(sql`${table.generationToken} is not null`),
    check(
      'content_asset_generation_key_nonempty_chk',
      sql`${table.generationKey} is null or length(${table.generationKey}) > 0`,
    ),
    check(
      'content_asset_generation_token_nonempty_chk',
      sql`${table.generationToken} is null or length(${table.generationToken}) > 0`,
    ),
    index('content_asset_work_idx').on(table.workId),
    index('content_asset_part_idx').on(table.partId),
    index('content_asset_generation_lease_idx').on(table.generationLeaseExpiresAt),
  ],
);

export const contentAssetRelations = relations(contentAsset, ({ one }) => ({
  work: one(readingWork, {
    fields: [contentAsset.workId],
    references: [readingWork.id],
  }),
  part: one(readingPart, {
    fields: [contentAsset.partId],
    references: [readingPart.id],
  }),
}));

/** Append-only TTS synthesis audit log (part generate / admin test). */
export const ttsInvocationLog = pgTable(
  'tts_invocation_log',
  {
    id: text('id').primaryKey(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    source: text('source').notNull(),
    userId: text('user_id'),
    workId: text('work_id'),
    partId: text('part_id'),
    voice: text('voice'),
    role: text('role'),
    textPreview: text('text_preview'),
    textLength: integer('text_length'),
    latencyMs: integer('latency_ms'),
    cached: boolean('cached'),
  },
  (table) => [
    index('tts_invocation_log_created_at_idx').on(table.createdAt),
    index('tts_invocation_log_status_created_idx').on(table.status, table.createdAt),
    index('tts_invocation_log_part_created_idx').on(table.partId, table.createdAt),
  ],
);

export type AiInvocationRequestSummary = {
  messageCount?: number;
  selectionPreview?: string;
  selectionLength?: number;
  toolNames?: string[];
  toolRoundCount?: number;
  actionId?: string;
};

export type AiInvocationResponseSummary = {
  replyPreview?: string;
  replyLength?: number;
};

/** Append-only AI call audit / spend log (one business invoke = one row). */
export const aiInvocationLog = pgTable(
  'ai_invocation_log',
  {
    id: text('id').primaryKey(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    purpose: text('purpose'),
    source: text('source').notNull(),
    userId: text('user_id'),
    refType: text('ref_type'),
    refId: text('ref_id'),
    modelRowId: text('model_row_id'),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    baseUrl: text('base_url'),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    costAmount: numeric('cost_amount', { precision: 18, scale: 8 }),
    costCurrency: text('cost_currency'),
    requestSummary: jsonb('request_summary').$type<AiInvocationRequestSummary>(),
    responseSummary: jsonb('response_summary').$type<AiInvocationResponseSummary>(),
  },
  (table) => [
    index('ai_invocation_log_created_at_idx').on(table.createdAt),
    index('ai_invocation_log_purpose_created_idx').on(table.purpose, table.createdAt),
    index('ai_invocation_log_source_created_idx').on(table.source, table.createdAt),
    index('ai_invocation_log_status_created_idx').on(table.status, table.createdAt),
  ],
);

export const llmProviderRelations = relations(llmProvider, ({ many }) => ({
  models: many(llmModel),
}));

export const llmModelRelations = relations(llmModel, ({ one }) => ({
  provider: one(llmProvider, {
    fields: [llmModel.providerId],
    references: [llmProvider.id],
  }),
}));

/**
 * User-scoped chat transcript SSOT (thread header).
 * Future embeddings / RAG / memory / cache must store pointers to these rows —
 * never duplicate full message bodies in derived tables.
 * `subjectId` is polymorphic (no reading_work FK) so surfaces beyond reading stay possible.
 */
export type ConversationMessageMetadata = {
  actionId?: string;
  selection?: string;
  question?: string;
  suggestions?: string[];
  invocationLogId?: string;
};

export const conversation = pgTable(
  'conversation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** e.g. assist-read — which product surface owns this thread. */
    surface: text('surface').notNull(),
    /** e.g. reading_work — polymorphic subject kind. */
    subjectType: text('subject_type').notNull(),
    /** Subject id (work id); no FK — keeps transcripts after subject deletion. */
    subjectId: text('subject_id').notNull(),
    preview: text('preview').notNull().default(''),
    /** Null while open; set when superseded by a newer thread in the same scope. */
    endedAt: timestamp('ended_at'),
    lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('conversation_user_last_msg_idx').on(table.userId, table.lastMessageAt),
    index('conversation_user_scope_last_idx').on(
      table.userId,
      table.surface,
      table.subjectType,
      table.subjectId,
      table.lastMessageAt,
    ),
    index('conversation_user_open_idx')
      .on(table.userId, table.surface, table.subjectType, table.subjectId)
      .where(sql`${table.endedAt} is null`),
  ],
);

/**
 * Append-only learner-visible message rows (transcript body).
 * Stable `id` is the future `source_message_id` for memory_item / embedding_ref / cache_entry.
 * Do not truncate content for storage — audit preview stays on ai_invocation_log only.
 */
export const conversationMessage = pgTable(
  'conversation_message',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull(),
    metadata: jsonb('metadata').$type<ConversationMessageMetadata>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('conversation_message_conv_created_idx').on(table.conversationId, table.createdAt)],
);

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  user: one(user, {
    fields: [conversation.userId],
    references: [user.id],
  }),
  messages: many(conversationMessage),
}));

export const conversationMessageRelations = relations(conversationMessage, ({ one }) => ({
  conversation: one(conversation, {
    fields: [conversationMessage.conversationId],
    references: [conversation.id],
  }),
}));

/** One Shanghai calendar day with recorded reading activity. */
export const readingDay = pgTable(
  'reading_day',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    /** Accumulated engaged reading seconds for this Shanghai calendar day (reader heartbeat). */
    engagedSeconds: integer('engaged_seconds').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique('reading_day_user_date_uidx').on(table.userId, table.localDate)],
);

export const readingDayRelations = relations(readingDay, ({ one }) => ({
  user: one(user, {
    fields: [readingDay.userId],
    references: [user.id],
  }),
}));

/**
 * Content-addressed object registry for the generic upload service.
 * One row per unique file (contentHash unique). `refCount` tracks how many
 * business rows (e.g. content_asset.origin_file) hold this object, so the
 * service can garbage-collect objects without knowing business tables.
 */
export const uploadedObject = pgTable(
  'uploaded_object',
  {
    id: text('id').primaryKey(),
    contentHash: text('content_hash').notNull().unique(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    refCount: integer('ref_count').notNull().default(1),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('uploaded_object_storage_key_idx').on(table.storageKey)],
);
