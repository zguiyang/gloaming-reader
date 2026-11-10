import { z } from 'zod';

import type {
  DictionaryConfigView,
  DictionaryContextExample,
  DictionaryDefinition,
  DictionaryEntry,
  DictionaryMeaning,
} from '@gloaming/shared/dictionary';

import { invokeAi } from '@/domains/ai';
import { toGenericDictionaryEntry } from '@/domains/dictionary/lookup/generic-entry';
import type { WorkReadActor } from '@/domains/works/access';
import { resolveReadableWorkIdForPart, resolveReadableWorkTitle } from '@/domains/works/access';
import { rootLogger } from '@/infra/logging/logger';

const logger = rootLogger.child({ module: 'DictionaryService' });

const ENRICHMENT_TIMEOUT_MS = 25_000;
const JSON_RETRY_ATTEMPTS = 2;

/** Meaning glosses only — used when the provider entry lacks Chinese definitions. */
const aiMeaningsOutputSchema = z.object({
  meanings: z.array(
    z.object({
      partOfSpeech: z.string(),
      definitionsZh: z.array(z.string()),
    }),
  ),
});

/** Request-scoped context translation — the primary AI enrichment for reading. */
const aiContextOnlyOutputSchema = z.object({
  contextSentenceZh: z.string().trim().min(1),
  contextNote: z.string().trim().min(1).optional(),
});

const MEANINGS_SCHEMA_HINT = `{
  "meanings": [
    { "partOfSpeech": "noun", "definitionsZh": ["简明中文释义"] }
  ]
}`;

const CONTEXT_SCHEMA_HINT = `{
  "contextSentenceZh": "上下文句子的自然中文翻译",
  "contextNote": "一两句说明该词在此句中的用法（可选）"
}`;

export type LookupContext = { sentence?: string; workId?: string; partId?: string; workTitle?: string };

function applyAiMeaningTranslations(
  entry: DictionaryEntry,
  aiMeanings: Array<{ partOfSpeech?: string; definitionsZh?: string[] }>,
): DictionaryMeaning[] {
  return entry.meanings.map((meaning) => {
    const matchedAiMeaning = aiMeanings.find(
      (m) => m?.partOfSpeech?.toLowerCase() === meaning.partOfSpeech.toLowerCase(),
    );
    const enrichedDefinitions: DictionaryDefinition[] = meaning.definitions.map((def, idx) => {
      const zh = matchedAiMeaning?.definitionsZh?.[idx];
      return {
        ...def,
        definitionZh: zh || def.definitionZh,
      };
    });
    return {
      ...meaning,
      definitions: enrichedDefinitions,
    };
  });
}

function entryHasChineseGloss(entry: DictionaryEntry): boolean {
  return entry.meanings.some((meaning) =>
    meaning.definitions.some((definition) => Boolean(definition.definitionZh?.trim())),
  );
}

function buildRequestContextExample(
  context: LookupContext,
  extras?: { sentenceZh?: string; note?: string },
): DictionaryContextExample | null {
  const sentence = context.sentence?.trim();
  if (!sentence) {
    return null;
  }
  return {
    sentence,
    sentenceZh: extras?.sentenceZh,
    note: extras?.note,
    workId: context.workId,
    partId: context.partId,
    workTitle: context.workTitle,
  };
}

function withRequestContextExample(
  entry: DictionaryEntry,
  contextExample: DictionaryContextExample | null,
): DictionaryEntry {
  if (!contextExample) {
    return toGenericDictionaryEntry(entry);
  }
  return {
    ...toGenericDictionaryEntry(entry),
    contextExamples: [contextExample],
  };
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('dictionary enrichment response did not contain a JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function formatValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Gateway-stable dictionary enrichment: plain chat (+ json_object when the wire
 * allows it), local Zod validation, and one correction retry. Never uses strict
 * provider JSON-Schema structured outputs (unreliable through ofox-style gateways).
 */
async function invokeDictionaryJson<TSchema extends z.ZodTypeAny>(options: {
  source: string;
  schema: TSchema;
  schemaHint: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}): Promise<z.infer<TSchema>> {
  const baseMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    ...options.messages,
    {
      role: 'user',
      content: `Return ONLY one JSON object (no markdown fences, no prose) matching this shape:\n${options.schemaHint}`,
    },
  ];

  let lastRaw = '';
  let lastError: unknown;

  for (let attempt = 0; attempt < JSON_RETRY_ATTEMPTS; attempt += 1) {
    const messages =
      attempt === 0
        ? baseMessages
        : [
            ...baseMessages,
            { role: 'assistant' as const, content: lastRaw || '{}' },
            {
              role: 'user' as const,
              content: `Previous JSON failed validation: ${formatValidationError(lastError)}. Return corrected JSON only.`,
            },
          ];

    const textResult = await invokeAi({
      purpose: 'assist',
      source: attempt === 0 ? options.source : `${options.source}.retry`,
      messages,
      timeoutMs: ENRICHMENT_TIMEOUT_MS,
      maxRetries: 0,
      jsonObject: true,
    });

    lastRaw = typeof textResult.content === 'string' ? textResult.content : JSON.stringify(textResult.content);

    try {
      return options.schema.parse(extractJsonObject(lastRaw));
    } catch (error) {
      lastError = error;
      logger.warn(
        { err: error, source: options.source, attempt: attempt + 1 },
        'Dictionary enrichment JSON validation failed',
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Generic meaning enrichment only — safe to persist. Skips AI when Chinese glosses already exist. */
export async function enrichGenericMeaningsWithAi(entry: DictionaryEntry): Promise<DictionaryEntry> {
  if (entryHasChineseGloss(entry)) {
    return toGenericDictionaryEntry(entry);
  }

  try {
    const promptLines: string[] = [
      `You are an expert English-to-Chinese lexicographer.`,
      `Provide accurate, natural, concise Chinese glosses for: "${entry.word}".`,
      ``,
      `English meanings:`,
      JSON.stringify(
        entry.meanings.map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: m.definitions.map((d) => d.definition),
        })),
        null,
        2,
      ),
      ``,
      `Return one definitionsZh string per English definition, aligned by index under the matching partOfSpeech.`,
    ];

    const parsed = await invokeDictionaryJson({
      source: 'dictionary:enrichment',
      schema: aiMeaningsOutputSchema,
      schemaHint: MEANINGS_SCHEMA_HINT,
      messages: [{ role: 'user', content: promptLines.join('\n') }],
    });

    const aiMeanings = Array.isArray(parsed?.meanings) ? parsed.meanings : [];
    return {
      ...toGenericDictionaryEntry(entry),
      meanings: applyAiMeaningTranslations(entry, aiMeanings),
    };
  } catch (error) {
    logger.warn({ err: error, word: entry.word }, 'AI dictionary enrichment failed; proceeding with base entry');
    return toGenericDictionaryEntry(entry);
  }
}

/**
 * Fresh provider lookup with optional context: meanings (only if missing zh) then
 * request-scoped context translation. Callers must persist only the generic half.
 */
export async function enrichFreshEntryWithAi(
  entry: DictionaryEntry,
  context?: LookupContext,
): Promise<{ generic: DictionaryEntry; response: DictionaryEntry }> {
  const hasContext = Boolean(context?.sentence?.trim());
  const generic = await enrichGenericMeaningsWithAi(entry);

  if (hasContext && context) {
    const response = await attachRequestScopedContext(generic, context);
    return {
      generic: toGenericDictionaryEntry(generic),
      response,
    };
  }

  const normalized = toGenericDictionaryEntry(generic);
  return { generic: normalized, response: normalized };
}

/** Request-scoped context only — must never be written to shared Redis/DB. */
async function attachRequestScopedContext(entry: DictionaryEntry, context: LookupContext): Promise<DictionaryEntry> {
  const generic = toGenericDictionaryEntry(entry);
  const sentence = context.sentence?.trim();
  if (!sentence) {
    return generic;
  }

  try {
    const promptLines: string[] = [
      `You are an expert English-to-Chinese reading companion.`,
      `Word: "${entry.word}"`,
      ``,
      `English meanings:`,
      JSON.stringify(
        entry.meanings.map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: m.definitions.map((d) => ({
            definition: d.definition,
            definitionZh: d.definitionZh,
          })),
        })),
        null,
        2,
      ),
      ``,
      `Context sentence from the book "${context.workTitle || 'Reading Material'}":`,
      `"${sentence}"`,
      ``,
      `Translate the full context sentence into natural Chinese (contextSentenceZh).`,
      `Optionally add a brief (1-2 sentences) reading note (contextNote) on how "${entry.word}" works in this sentence.`,
    ];

    const parsed = await invokeDictionaryJson({
      source: 'dictionary:context',
      schema: aiContextOnlyOutputSchema,
      schemaHint: CONTEXT_SCHEMA_HINT,
      messages: [{ role: 'user', content: promptLines.join('\n') }],
    });

    return withRequestContextExample(
      generic,
      buildRequestContextExample(context, {
        sentenceZh: parsed.contextSentenceZh,
        note: parsed.contextNote,
      }),
    );
  } catch (error) {
    logger.warn({ err: error, word: entry.word }, 'AI dictionary context enrichment failed; returning sentence only');
    return withRequestContextExample(generic, buildRequestContextExample(context));
  }
}

export async function resolveWorkTitle(actor: WorkReadActor, workId?: string): Promise<string | undefined> {
  if (!workId) {
    return undefined;
  }
  return resolveReadableWorkTitle(actor, workId);
}

export async function attachContextForResponse(
  actor: WorkReadActor,
  entry: DictionaryEntry,
  options: { contextSentence?: string; workId?: string; partId?: string },
  config: DictionaryConfigView,
): Promise<DictionaryEntry> {
  const sentence = options.contextSentence?.trim();
  if (!sentence) {
    return toGenericDictionaryEntry(entry);
  }

  let workId = options.workId;
  if (!workId && options.partId) {
    workId = await resolveReadableWorkIdForPart(actor, options.partId);
  }
  const workTitle = await resolveWorkTitle(actor, workId);
  const context: LookupContext = {
    sentence,
    workId: workTitle ? workId : undefined,
    partId: workTitle ? options.partId : undefined,
    workTitle,
  };

  if (config.enableAiEnrichment) {
    return attachRequestScopedContext(entry, context);
  }

  return withRequestContextExample(entry, buildRequestContextExample(context));
}

export function withStaticRequestContext(entry: DictionaryEntry, context: LookupContext): DictionaryEntry {
  return withRequestContextExample(entry, buildRequestContextExample(context));
}
