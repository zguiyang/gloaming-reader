import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
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

/** Work-level reading stats provenance — algorithm from parse vs admin manual override. */
export type WorkStatsProvenance = 'algorithm' | 'manual';
export type WorkDescriptionProvenance = 'extracted' | 'ai' | 'manual';

/** Reading catalog root — metadata only, no body (ADR-001). */
export const readingWork = pgTable(
  'reading_work',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    author: text('author').notNull().default(''),
    description: text('description').notNull().default(''),
    language: text('language').notNull().default('en'),
    processingStatus: text('processing_status').notNull().default('processing'),
    visibility: text('visibility').notNull().default('catalog'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    originKind: text('origin_kind').$type<'user_epub' | null>(),
    originMeta: jsonb('origin_meta').$type<Record<string, unknown>>().notNull().default({}),
    descriptionProvenance: text('description_provenance').$type<WorkDescriptionProvenance | null>(),
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
    index('reading_work_processing_status_idx').on(table.processingStatus),
    index('reading_work_owner_user_id_idx').on(table.ownerUserId),
    index('reading_work_published_at_idx').on(table.publishedAt),
    check('reading_work_origin_kind_check', sql`${table.originKind} IS NULL OR ${table.originKind} = 'user_epub'`),
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

/** Explicit Catalog membership in a user's Library — separate from reading_state progress (ADR-001). */
export const userLibraryItem = pgTable(
  'user_library_item',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('user_library_item_user_work_uidx').on(table.userId, table.workId),
    index('user_library_item_user_idx').on(table.userId),
    index('user_library_item_work_idx').on(table.workId),
  ],
);

/** Provenance of a user-owned tag or tag association. */
export type UserTagProvenance = 'manual' | 'ai';

/** Lifecycle state of a Personal tag run row (queue recovery and idempotence). */
export type PersonalTagRunState = 'queued' | 'processing' | 'completed' | 'skipped' | 'failed';

/** Private, user-managed Library labels. */
export const userTag = pgTable(
  'user_tag',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    /** Creation provenance: `manual` for user-created tags, `ai` for the automatic organizer. */
    createdBy: text('created_by').$type<UserTagProvenance>().default('manual').notNull(),
    /** Locale of the original user-entered name; null for tags created before locale tracking. */
    sourceLocale: text('source_locale'),
    /** Explicit localized names keyed by SUPPORTED_LOCALES; missing keys are untranslated. */
    localizedNames: jsonb('localized_names').$type<Record<string, string>>().default({}).notNull(),
    /** Locales explicitly edited by the user; AI completion must never overwrite these keys. */
    userEditedLocales: text('user_edited_locales').array().default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('user_tag_user_normalized_name_uidx').on(table.userId, table.normalizedName),
    unique('user_tag_user_id_id_uidx').on(table.userId, table.id),
    index('user_tag_user_idx').on(table.userId),
    check('user_tag_created_by_check', sql`${table.createdBy} in ('manual', 'ai')`),
  ],
);

/** A user's organization label on a Work they own or explicitly saved. */
export const userWorkTag = pgTable(
  'user_work_tag',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull(),
    /** Association provenance: `manual` for explicit user assignment, `ai` for the automatic organizer. */
    source: text('source').$type<UserTagProvenance>().default('manual').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.tagId],
      foreignColumns: [userTag.userId, userTag.id],
      name: 'user_work_tag_user_tag_fk',
    }).onDelete('cascade'),
    unique('user_work_tag_user_work_tag_uidx').on(table.userId, table.workId, table.tagId),
    index('user_work_tag_user_work_idx').on(table.userId, table.workId),
    index('user_work_tag_user_tag_idx').on(table.userId, table.tagId),
    check('user_work_tag_source_check', sql`${table.source} in ('manual', 'ai')`),
  ],
);

/** Per-user opt-in for automatic Personal EPUB tagging. */
export const userPersonalTagPreference = pgTable(
  'user_personal_tag_preference',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Master opt-in; an absent row or false means automatic tagging is off. */
    enabled: boolean('enabled').default(false).notNull(),
    /** Monotonic generation bumped when the user requests a fresh automatic run. */
    generation: integer('generation').default(0).notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [check('user_personal_tag_preference_generation_nonnegative_chk', sql`${table.generation} >= 0`)],
);

/** Exact user/work/tag triple a user removed manually; AI must not restore it. */
export const userWorkTagSuppression = pgTable(
  'user_work_tag_suppression',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull(),
    removedAt: timestamp('removed_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.tagId],
      foreignColumns: [userTag.userId, userTag.id],
      name: 'user_work_tag_suppression_user_tag_fk',
    }).onDelete('cascade'),
    unique('user_work_tag_suppression_user_work_tag_uidx').on(table.userId, table.workId, table.tagId),
  ],
);

/** Per-user/per-work Personal tag run outbox row; one per captured generation. */
export const userPersonalTagRun = pgTable(
  'user_personal_tag_run',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workId: text('work_id')
      .notNull()
      .references(() => readingWork.id, { onDelete: 'cascade' }),
    /** Preference generation captured when the run was enqueued. */
    generation: integer('generation').notNull(),
    state: text('state').$type<PersonalTagRunState>().default('queued').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    /** Stable error code only; never prompt, excerpt, or model output. */
    errorCode: text('error_code'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('user_personal_tag_run_user_work_generation_uidx').on(table.userId, table.workId, table.generation),
    index('user_personal_tag_run_state_idx').on(table.state),
    check(
      'user_personal_tag_run_state_check',
      sql`${table.state} in ('queued', 'processing', 'completed', 'skipped', 'failed')`,
    ),
    check('user_personal_tag_run_attempts_nonnegative_chk', sql`${table.attempts} >= 0`),
  ],
);

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
  libraryItems: many(userLibraryItem),
}));

export const userLibraryItemRelations = relations(userLibraryItem, ({ one }) => ({
  user: one(user, {
    fields: [userLibraryItem.userId],
    references: [user.id],
  }),
  work: one(readingWork, {
    fields: [userLibraryItem.workId],
    references: [readingWork.id],
  }),
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

/** LLM gateway credentials (API key encrypted at rest); instance or per-user scope. */
export const llmProvider = pgTable(
  'llm_provider',
  {
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
    /** Null = instance-wide provider; non-null = user-owned override. */
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    isEnabled: boolean('is_enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('llm_provider_user_name_uidx')
      .on(table.ownerUserId, table.name)
      .where(sql`${table.ownerUserId} is not null`),
  ],
);

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

/** App-level purpose → default model binding (instance or per-user scope). */
export const llmAppSetting = pgTable(
  'llm_app_setting',
  {
    id: text('id').primaryKey(),
    /** Null = instance setting; non-null = user-owned override. */
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('llm_app_setting_instance_key_uidx')
      .on(table.key)
      .where(sql`${table.ownerUserId} is null`),
    uniqueIndex('llm_app_setting_user_key_uidx')
      .on(table.ownerUserId, table.key)
      .where(sql`${table.ownerUserId} is not null`),
  ],
);

/** Azure TTS credentials + voice bindings (one instance row or one per user). */
export const ttsConfig = pgTable(
  'tts_config',
  {
    id: text('id').primaryKey(),
    /** Null = instance config; non-null = user-owned override. */
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
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
  },
  (table) => [
    uniqueIndex('tts_config_instance_uidx')
      .on(sql`true`)
      .where(sql`${table.ownerUserId} is null`),
    uniqueIndex('tts_config_user_uidx')
      .on(table.ownerUserId)
      .where(sql`${table.ownerUserId} is not null`),
  ],
);

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
  /** MIME type of the source bytes before ingest image optimization. */
  sourceMimeType?: string;
  /** Byte length of the source image before ingest optimization. */
  sourceSize?: number;
  /** Ingest image optimization applied at parse time (`none` | `webp`). */
  transform?: 'none' | 'webp';
  /** Version of the ingest image transform rules (e.g. `1`). */
  transformVersion?: string;
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
  selectionLength?: number;
  toolNames?: string[];
  toolRoundCount?: number;
  actionId?: string;
  phase?: string;
  workId?: string;
  neededFields?: string;
};

export type AiInvocationResponseSummary = {
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

export const llmProviderRelations = relations(llmProvider, ({ one, many }) => ({
  owner: one(user, {
    fields: [llmProvider.ownerUserId],
    references: [user.id],
  }),
  models: many(llmModel),
}));

export const llmAppSettingRelations = relations(llmAppSetting, ({ one }) => ({
  owner: one(user, {
    fields: [llmAppSetting.ownerUserId],
    references: [user.id],
  }),
}));

export const ttsConfigRelations = relations(ttsConfig, ({ one }) => ({
  owner: one(user, {
    fields: [ttsConfig.ownerUserId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  libraryItems: many(userLibraryItem),
  ownedLlmProviders: many(llmProvider),
  ownedLlmAppSettings: many(llmAppSetting),
  ownedTtsConfigs: many(ttsConfig),
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

/** Durable dedupe records for reader heartbeat delivery within a bounded retry window. */
export const readingHeartbeat = pgTable(
  'reading_heartbeat',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    seconds: integer('seconds').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('reading_heartbeat_identity_uidx').on(table.userId, table.sessionId, table.sequenceNumber),
    index('reading_heartbeat_created_at_idx').on(table.createdAt),
    index('reading_heartbeat_user_created_at_idx').on(table.userId, table.createdAt),
  ],
);

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

/** Source-registry sync status for a DiscoverySource. */
export type DiscoverySourceSyncStatus = 'idle' | 'queued' | 'syncing' | 'succeeded' | 'failed';

/**
 * Observable stage of one discovery sync run. Non-terminal stages mirror the
 * phases of the sync service; terminal stages are the persisted run outcomes.
 * `skipped` covers runs that ended without fetching upstream (disabled source,
 * superseded claim); `not_modified` is a successful 304 outcome and is kept
 * distinct from `succeeded` so operators can tell a real scan from a no-op.
 */
export type DiscoverySyncRunStage =
  'queued' | 'downloading' | 'processing' | 'reconciling' | 'succeeded' | 'not_modified' | 'skipped' | 'failed';

/** Terminal discovery sync run stages; non-terminal stages stay open for progress writes. */
export const DISCOVERY_SYNC_RUN_TERMINAL_STAGES = ['succeeded', 'not_modified', 'skipped', 'failed'] as const;
export function isDiscoverySyncRunTerminalStage(stage: DiscoverySyncRunStage): boolean {
  return (DISCOVERY_SYNC_RUN_TERMINAL_STAGES as readonly string[]).includes(stage);
}

/** Bounded number of recent sync runs kept/exposed per source. */
export const DISCOVERY_SYNC_RUN_HISTORY_LIMIT = 20;

/**
 * External catalog source registry (ADR DS-02).
 * Holds source identity plus the sync run/snapshot state used for conditional refresh.
 * Source credentials are server configuration, never client-visible; not modeled here.
 */
export const discoverySource = pgTable(
  'discovery_source',
  {
    id: text('id').primaryKey(),
    /** Stable source identity used by adapters (e.g. `project_gutenberg`). */
    sourceKey: text('source_key').notNull(),
    /** Adapter/protocol family for this source. */
    sourceType: text('source_type').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    /** Current sync run status. */
    syncStatus: text('sync_status').$type<DiscoverySourceSyncStatus>().notNull().default('idle'),
    syncStartedAt: timestamp('sync_started_at'),
    syncFinishedAt: timestamp('sync_finished_at'),
    /** Last fully successful snapshot sync. */
    lastSuccessAt: timestamp('last_success_at'),
    /** Sanitized operational error summary; never credentials or raw stack traces. */
    lastErrorSummary: text('last_error_summary'),
    /** Upstream snapshot validator for conditional refresh (e.g. HTTP Last-Modified). */
    snapshotLastModified: text('snapshot_last_modified'),
    /** Upstream snapshot version/ETag state for conditional refresh. */
    snapshotVersion: text('snapshot_version'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('discovery_source_key_uidx').on(table.sourceKey),
    check('discovery_source_key_nonempty_chk', sql`length(${table.sourceKey}) > 0`),
    check(
      'discovery_source_sync_status_check',
      sql`${table.syncStatus} in ('idle', 'queued', 'syncing', 'succeeded', 'failed')`,
    ),
  ],
);

export type SourceRecordAuthor = {
  name: string;
  sortName?: string;
  role?: string;
};

/** Compact source-provided metadata preserved from the upstream record. */
export type SourceRecordSourceMeta = {
  subjects?: string[];
  bookshelves?: string[];
  extra?: Record<string, unknown>;
};

/** One upstream content file candidate (e.g. an EPUB); never downloaded by this layer. */
export type SourceRecordContentCandidate = {
  /** Source format label (e.g. `epub`, `html`). */
  format: string;
  /** Candidate URL as provided by the source. */
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Upstream file/format update timestamp when the source provides one. */
  updatedAt?: string;
};

export type SourceRecordAvailability = 'available' | 'unavailable';

/**
 * Materialization progress for the (optional) SourceRecord → ReadingWork link.
 * Deliberately separate from `availability` (source metadata presence) and from
 * DiscoverySource `sync_status` (upstream metadata sync state).
 */
export type SourceRecordMaterializationStatus = 'not_materialized' | 'processing' | 'ready' | 'failed';

/**
 * One external bibliographic record owned by a DiscoverySource.
 * Identity is per-source: unique on (source_id, external_id).
 * Metadata is source-authoritative; `work_id` is an optional link to the
 * ReadingWork materialized from this record, never a Library/reading entity.
 */
export const sourceRecord = pgTable(
  'source_record',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => discoverySource.id, { onDelete: 'cascade' }),
    /** Source-scoped external identifier (e.g. Gutenberg ebook id). */
    externalId: text('external_id').notNull(),
    title: text('title').notNull().default(''),
    /** Ordered authors; preserves multiple authorship from the source. */
    authors: jsonb('authors').$type<SourceRecordAuthor[]>().notNull().default([]),
    /** All language codes provided by the source (e.g. `['en', 'fr']`). */
    languages: text('languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text('description'),
    /** Source rights statement — the single source of truth for rights text. */
    rightsStatement: text('rights_statement'),
    /** Source cover candidate URL — not a stored asset. */
    coverUrl: text('cover_url'),
    /** All source content candidates (e.g. EPUB formats); never downloaded here. */
    contentCandidates: jsonb('content_candidates').$type<SourceRecordContentCandidate[]>().notNull().default([]),
    sourceMeta: jsonb('source_meta').$type<SourceRecordSourceMeta>().notNull().default({}),
    availability: text('availability').$type<SourceRecordAvailability>().notNull().default('available'),
    /**
     * Optional materialized ReadingWork. Nullable and `onDelete: 'set null'`:
     * deleting this SourceRecord (or its owning DiscoverySource) never deletes the
     * Work, and deleting the Work only unlinks the record.
     */
    workId: text('work_id').references(() => readingWork.id, { onDelete: 'set null' }),
    materializationStatus: text('materialization_status')
      .$type<SourceRecordMaterializationStatus>()
      .notNull()
      .default('not_materialized'),
    /** Upstream record/format update timestamp, when the source provides one. */
    sourceUpdatedAt: timestamp('source_updated_at'),
    /** Last successful snapshot sync that observed this record. */
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('source_record_source_external_uidx').on(table.sourceId, table.externalId),
    check('source_record_external_id_nonempty_chk', sql`length(${table.externalId}) > 0`),
    check('source_record_availability_check', sql`${table.availability} in ('available', 'unavailable')`),
    check(
      'source_record_materialization_status_check',
      sql`${table.materializationStatus} in ('not_materialized', 'processing', 'ready', 'failed')`,
    ),
    /** At most one SourceRecord per ReadingWork (Postgres unique allows many NULLs). */
    unique('source_record_work_uidx').on(table.workId),
    index('source_record_source_idx').on(table.sourceId),
    index('source_record_source_availability_idx').on(table.sourceId, table.availability),
    index('source_record_languages_gin_idx').using('gin', table.languages),
    index('source_record_last_seen_idx').on(table.lastSeenAt),
  ],
);

/**
 * One durable observability record per manual sync run (ADR DS-02).
 *
 * Identity and fencing: a run row is created when an admin trigger claims the
 * source, keyed by the claim generation token (`claim_token` = the queued
 * `syncStartedAt`). Every later transition of the same generation re-enters
 * through `startSourceSyncing`, which writes the executor's `runStartedAt`
 * (`start_token`); progress and terminal writes verify both tokens under the
 * source-row lock, so a stale executor from an older generation can never
 * advance counters or overwrite a terminal result of another run.
 *
 * Metrics are current-run facts only: `committed_records`/`committed_batches`
 * count what THIS run committed (a rolled-back batch increments nothing) and
 * are distinct from the source-level total `record_count`. No totals,
 * percentages, or inserted/updated splits are persisted or exposed.
 */
export const discoverySyncRun = pgTable(
  'discovery_sync_run',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => discoverySource.id, { onDelete: 'cascade' }),
    /** Claim generation token that created this run (source `syncStartedAt` at queue time). */
    claimToken: timestamp('claim_token').notNull(),
    /** Execution token written by `startSourceSyncing`; null while the run is still queued. */
    startToken: timestamp('start_token'),
    stage: text('stage').$type<DiscoverySyncRunStage>().notNull().default('queued'),
    /** Records this run committed across its batches (rolled-back batches never count). */
    committedRecords: integer('committed_records').notNull().default(0),
    /** Fully committed upsert batches of this run. */
    committedBatches: integer('committed_batches').notNull().default(0),
    /** Records reconciled as unavailable by this run's successful reconciliation. */
    unavailableRecords: integer('unavailable_records').notNull().default(0),
    queuedAt: timestamp('queued_at').notNull(),
    startedAt: timestamp('started_at'),
    /** Truthful last activity: batch commits and phase transitions only — never a worker heartbeat. */
    lastActivityAt: timestamp('last_activity_at').notNull(),
    finishedAt: timestamp('finished_at'),
    /** Sanitized operational error summary; never credentials, URLs, or raw stack traces. */
    errorSummary: text('error_summary'),
    /** Upstream snapshot Last-Modified reported by a successful scan (succeeded/not_modified). */
    snapshotLastModified: text('snapshot_last_modified'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('discovery_sync_run_source_claim_uidx').on(table.sourceId, table.claimToken),
    index('discovery_sync_run_source_queued_idx').on(table.sourceId, table.queuedAt),
    check('discovery_sync_run_committed_records_nonnegative_chk', sql`${table.committedRecords} >= 0`),
    check('discovery_sync_run_committed_batches_nonnegative_chk', sql`${table.committedBatches} >= 0`),
    check('discovery_sync_run_unavailable_records_nonnegative_chk', sql`${table.unavailableRecords} >= 0`),
    check(
      'discovery_sync_run_stage_check',
      sql`${table.stage} in ('queued', 'downloading', 'processing', 'reconciling', 'succeeded', 'not_modified', 'skipped', 'failed')`,
    ),
  ],
);

export const discoverySourceRelations = relations(discoverySource, ({ many }) => ({
  records: many(sourceRecord),
  syncRuns: many(discoverySyncRun),
}));

export const discoverySyncRunRelations = relations(discoverySyncRun, ({ one }) => ({
  source: one(discoverySource, {
    fields: [discoverySyncRun.sourceId],
    references: [discoverySource.id],
  }),
}));

export const sourceRecordRelations = relations(sourceRecord, ({ one }) => ({
  source: one(discoverySource, {
    fields: [sourceRecord.sourceId],
    references: [discoverySource.id],
  }),
  work: one(readingWork, {
    fields: [sourceRecord.workId],
    references: [readingWork.id],
  }),
}));

/**
 * Lifecycle of one user's intent to save a SourceRecord into their Library.
 * `pending` waits for materialization, `completed` means the Library membership
 * exists, `failed` is a retryable terminal state. It is never a Library membership
 * itself: only a `user_library_item` created after a readable import counts.
 */
export type SourceRecordSaveIntentStatus = 'pending' | 'failed' | 'completed';

export const sourceRecordSaveIntent = pgTable(
  'source_record_save_intent',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceRecordId: text('source_record_id')
      .notNull()
      .references(() => sourceRecord.id, { onDelete: 'cascade' }),
    status: text('status').$type<SourceRecordSaveIntentStatus>().notNull().default('pending'),
    /** Cleaned, short machine code for a failed materialization. */
    failureCode: text('failure_code'),
    /** Cleaned, short human-readable reason; never a raw stack or response body. */
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    /** One intent per (user, SourceRecord); repeated saves are idempotent. */
    unique('source_record_save_intent_user_record_uidx').on(table.userId, table.sourceRecordId),
    index('source_record_save_intent_user_idx').on(table.userId),
    index('source_record_save_intent_record_status_idx').on(table.sourceRecordId, table.status),
    check('source_record_save_intent_status_check', sql`${table.status} in ('pending', 'failed', 'completed')`),
    check(
      'source_record_save_intent_failure_code_nonempty_chk',
      sql`${table.failureCode} is null or length(${table.failureCode}) > 0`,
    ),
  ],
);

export const sourceRecordSaveIntentRelations = relations(sourceRecordSaveIntent, ({ one }) => ({
  user: one(user, {
    fields: [sourceRecordSaveIntent.userId],
    references: [user.id],
  }),
  sourceRecord: one(sourceRecord, {
    fields: [sourceRecordSaveIntent.sourceRecordId],
    references: [sourceRecord.id],
  }),
}));

/** Provenance for a public Discover category, its labels, and SourceRecord assignments. */
export type PublicCategoryProvenance = 'manual' | 'ai';

/**
 * One flat, stable, instance-wide Discover category. Identity is `id`; localized
 * display names live on `public_category_label`, so renaming or translating a
 * category never changes its identity. No parent/hierarchy and no sharing with
 * private User Tags.
 */
export const publicCategory = pgTable(
  'public_category',
  {
    id: text('id').primaryKey(),
    /** Creation provenance: `manual` for explicit creation, `ai` for automatic classification. */
    createdBy: text('created_by').$type<PublicCategoryProvenance>().default('manual').notNull(),
    /** Locale of the canonical label when the creator recorded one; null when unknown. */
    sourceLocale: text('source_locale'),
    /** Concise internal scope/meaning used for candidate retrieval; null when unrecorded. */
    meaning: text('meaning'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [check('public_category_created_by_check', sql`${table.createdBy} in ('manual', 'ai')`)],
);

/**
 * One localized display name for a public category. `normalized_name` is the
 * Unicode NFC / whitespace-folded / case-folded comparison key produced by the
 * shared `normalizePublicCategoryName` contract. `edited_by = 'manual'` marks a
 * name that automatic translation or AI completion must never overwrite.
 * Uniqueness is per locale so two categories cannot claim the same name in one
 * language while one concept may still carry labels across languages.
 */
export const publicCategoryLabel = pgTable(
  'public_category_label',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id').notNull(),
    locale: text('locale').notNull(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    /** Edit provenance: `manual` labels are protected from automatic updates. */
    editedBy: text('edited_by').$type<PublicCategoryProvenance>().default('manual').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [publicCategory.id],
      name: 'public_category_label_category_fk',
    }).onDelete('cascade'),
    unique('public_category_label_category_locale_uidx').on(table.categoryId, table.locale),
    unique('public_category_label_locale_normalized_name_uidx').on(table.locale, table.normalizedName),
    check('public_category_label_edited_by_check', sql`${table.editedBy} in ('manual', 'ai')`),
    check('public_category_label_name_nonempty_chk', sql`length(${table.name}) > 0`),
    check('public_category_label_normalized_name_nonempty_chk', sql`length(${table.normalizedName}) > 0`),
  ],
);

/**
 * One known localized synonym for a public category, separate from the display
 * label. Aliases feed candidate retrieval (decision-A equivalence) so a source
 * term such as `Sci-Fi` can find the `Science Fiction` category. `normalized_name`
 * uses the same `normalizePublicCategoryName` contract and is unique per locale so
 * two categories cannot claim the same synonym. `edited_by = 'manual'` marks a
 * synonym automation must never overwrite.
 */
export const publicCategoryAlias = pgTable(
  'public_category_alias',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id').notNull(),
    locale: text('locale').notNull(),
    alias: text('alias').notNull(),
    normalizedName: text('normalized_name').notNull(),
    /** Edit provenance: `manual` aliases are protected from automatic updates. */
    editedBy: text('edited_by').$type<PublicCategoryProvenance>().default('manual').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [publicCategory.id],
      name: 'public_category_alias_category_fk',
    }).onDelete('cascade'),
    unique('public_category_alias_category_locale_normalized_uidx').on(
      table.categoryId,
      table.locale,
      table.normalizedName,
    ),
    unique('public_category_alias_locale_normalized_name_uidx').on(table.locale, table.normalizedName),
    check('public_category_alias_edited_by_check', sql`${table.editedBy} in ('manual', 'ai')`),
    check('public_category_alias_nonempty_chk', sql`length(${table.alias}) > 0`),
    check('public_category_alias_normalized_name_nonempty_chk', sql`length(${table.normalizedName}) > 0`),
  ],
);

/**
 * Many-to-many public classification of a SourceRecord. Raw `sourceMeta`
 * Subjects/Bookshelves remain untouched; these rows are the projected product
 * categories. One category may classify many records and a record may carry
 * several categories; the owning service enforces the 0–3 product limit.
 */
export const sourceRecordPublicCategory = pgTable(
  'source_record_public_category',
  {
    id: text('id').primaryKey(),
    sourceRecordId: text('source_record_id').notNull(),
    categoryId: text('category_id').notNull(),
    /** Assignment provenance: `manual` for explicit assignment, `ai` for automatic classification. */
    source: text('source').$type<PublicCategoryProvenance>().default('manual').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceRecordId],
      foreignColumns: [sourceRecord.id],
      name: 'source_record_public_category_record_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [publicCategory.id],
      name: 'source_record_public_category_category_fk',
    }).onDelete('cascade'),
    unique('source_record_public_category_record_category_uidx').on(table.sourceRecordId, table.categoryId),
    index('source_record_public_category_category_idx').on(table.categoryId),
    check('source_record_public_category_source_check', sql`${table.source} in ('manual', 'ai')`),
  ],
);

/**
 * Exact SourceRecord/category pair removed explicitly. Normal AI retry must
 * consult this and never restore the assignment; only a new explicit request
 * may clear the suppression. Mirrors the Personal Tag suppression boundary.
 */
export const sourceRecordPublicCategorySuppression = pgTable(
  'source_record_public_category_suppression',
  {
    sourceRecordId: text('source_record_id').notNull(),
    categoryId: text('category_id').notNull(),
    removedAt: timestamp('removed_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceRecordId],
      foreignColumns: [sourceRecord.id],
      name: 'source_record_public_category_suppression_record_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [publicCategory.id],
      name: 'source_record_public_category_suppression_category_fk',
    }).onDelete('cascade'),
    unique('source_record_public_category_suppression_record_category_uidx').on(table.sourceRecordId, table.categoryId),
    index('source_record_public_category_suppression_category_idx').on(table.categoryId),
  ],
);

/**
 * Durable per-SourceRecord memory for incremental public classification.
 *
 * BullMQ retention removes completed/failed jobs, so a stable job id alone
 * cannot remember the last successfully classified evidence fingerprint nor a
 * deferred retry time. This small Discovery-owned row closes that gap:
 * `evidence_fingerprint` is the latest classification evidence queued for the
 * record, `completed_fingerprint` is the evidence that finished successfully,
 * and `next_attempt_at` gates retries so a deferred record is not re-enqueued in
 * a rapid loop. It never stores category assignments (those stay in
 * `source_record_public_category`) and never mutates raw source metadata.
 */
export const sourceRecordPublicClassificationState = pgTable(
  'source_record_public_classification_state',
  {
    sourceRecordId: text('source_record_id')
      .primaryKey()
      .references(() => sourceRecord.id, { onDelete: 'cascade' }),
    /** Stable fingerprint of the bounded classification inputs most recently queued. */
    evidenceFingerprint: text('evidence_fingerprint').notNull(),
    /** Fingerprint of the evidence that last completed classification; null when not yet done. */
    completedFingerprint: text('completed_fingerprint'),
    /** Earliest time a deferred or new fingerprint may be attempted again. */
    nextAttemptAt: timestamp('next_attempt_at').defaultNow().notNull(),
    /** Last deferral reason, for observability; null once completed. */
    lastDeferredReason: text('last_deferred_reason'),
    /** Count of deferrals since the current evidence fingerprint was first queued. */
    retryCount: integer('retry_count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check('source_record_public_classification_retry_nonnegative_chk', sql`${table.retryCount} >= 0`),
    index('source_record_public_classification_due_idx').on(table.nextAttemptAt),
  ],
);

export const sourceRecordPublicClassificationStateRelations = relations(
  sourceRecordPublicClassificationState,
  ({ one }) => ({
    sourceRecord: one(sourceRecord, {
      fields: [sourceRecordPublicClassificationState.sourceRecordId],
      references: [sourceRecord.id],
    }),
  }),
);

export const publicCategoryRelations = relations(publicCategory, ({ many }) => ({
  labels: many(publicCategoryLabel),
  aliases: many(publicCategoryAlias),
  sourceRecordAssignments: many(sourceRecordPublicCategory),
}));

export const publicCategoryLabelRelations = relations(publicCategoryLabel, ({ one }) => ({
  category: one(publicCategory, {
    fields: [publicCategoryLabel.categoryId],
    references: [publicCategory.id],
  }),
}));

export const publicCategoryAliasRelations = relations(publicCategoryAlias, ({ one }) => ({
  category: one(publicCategory, {
    fields: [publicCategoryAlias.categoryId],
    references: [publicCategory.id],
  }),
}));

export const sourceRecordPublicCategoryRelations = relations(sourceRecordPublicCategory, ({ one }) => ({
  sourceRecord: one(sourceRecord, {
    fields: [sourceRecordPublicCategory.sourceRecordId],
    references: [sourceRecord.id],
  }),
  category: one(publicCategory, {
    fields: [sourceRecordPublicCategory.categoryId],
    references: [publicCategory.id],
  }),
}));

export const sourceRecordPublicCategorySuppressionRelations = relations(
  sourceRecordPublicCategorySuppression,
  ({ one }) => ({
    sourceRecord: one(sourceRecord, {
      fields: [sourceRecordPublicCategorySuppression.sourceRecordId],
      references: [sourceRecord.id],
    }),
    category: one(publicCategory, {
      fields: [sourceRecordPublicCategorySuppression.categoryId],
      references: [publicCategory.id],
    }),
  }),
);
