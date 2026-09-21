import { z } from 'zod';

import type {
  DictionaryConfigView,
  DictionaryContextExample,
  DictionaryDefinition,
  DictionaryEntry,
  DictionaryMeaning,
} from '@gloaming/shared/dictionary';

import { rootLogger } from '@/lib/logger';
import { invokeAi } from '@/modules/ai';
import { toGenericDictionaryEntry } from '@/modules/dictionary/lookup/generic-entry';
import { getPublishedWorkTitle } from '@/modules/works/read-model/catalog';

const logger = rootLogger.child({ module: 'DictionaryService' });

const aiEnrichmentOutputSchema = z.object({
  meanings: z.array(
    z.object({
      partOfSpeech: z.string(),
      definitionsZh: z.array(z.string()),
    }),
  ),
  contextSentenceZh: z.string().optional(),
  contextNote: z.string().optional(),
});

const aiContextOnlyOutputSchema = z.object({
  contextSentenceZh: z.string().optional(),
  contextNote: z.string().optional(),
});

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

/** Generic meaning enrichment only — safe to persist. */
export async function enrichGenericMeaningsWithAi(entry: DictionaryEntry): Promise<DictionaryEntry> {
  try {
    const promptLines: string[] = [
      `You are an expert English-to-Chinese lexicographer and reading companion.`,
      `Provide accurate, natural, and concise Chinese translations for the following dictionary word: "${entry.word}".`,
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
    ];

    const aiResult = await invokeAi({
      purpose: 'assist',
      source: 'dictionary:enrichment',
      messages: [{ role: 'user', content: promptLines.join('\n') }],
      outputSchema: aiEnrichmentOutputSchema,
      timeoutMs: 15000,
    });

    const aiMeanings = Array.isArray(aiResult.content?.meanings) ? aiResult.content.meanings : [];
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
 * Fresh provider lookup with optional context: one AI call may enrich meanings and
 * request-scoped context. Callers must persist only the generic half.
 */
export async function enrichFreshEntryWithAi(
  entry: DictionaryEntry,
  context?: LookupContext,
): Promise<{ generic: DictionaryEntry; response: DictionaryEntry }> {
  const hasContext = Boolean(context?.sentence?.trim());
  try {
    const promptLines: string[] = [
      `You are an expert English-to-Chinese lexicographer and reading companion.`,
      `Provide accurate, natural, and concise Chinese translations for the following dictionary word: "${entry.word}".`,
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
    ];

    if (hasContext && context) {
      promptLines.push(
        ``,
        `Context sentence from the book "${context.workTitle || 'Reading Material'}":`,
        `"${context.sentence!.trim()}"`,
        ``,
        `Translate the context sentence into natural Chinese (contextSentenceZh), and provide a brief (1-2 sentences) reading note (contextNote) explaining how "${entry.word}" functions or is nuanced in this context.`,
      );
    }

    const aiResult = await invokeAi({
      purpose: 'assist',
      source: 'dictionary:enrichment',
      messages: [{ role: 'user', content: promptLines.join('\n') }],
      outputSchema: aiEnrichmentOutputSchema,
      timeoutMs: 15000,
    });

    const parsed = aiResult.content;
    const aiMeanings = Array.isArray(parsed?.meanings) ? parsed.meanings : [];
    const generic: DictionaryEntry = {
      ...toGenericDictionaryEntry(entry),
      meanings: applyAiMeaningTranslations(entry, aiMeanings),
    };
    const contextExample = hasContext
      ? buildRequestContextExample(context!, {
          sentenceZh: parsed?.contextSentenceZh,
          note: parsed?.contextNote,
        })
      : null;

    return {
      generic,
      response: withRequestContextExample(generic, contextExample),
    };
  } catch (error) {
    logger.warn({ err: error, word: entry.word }, 'AI dictionary enrichment failed; proceeding with base entry');
    const generic = toGenericDictionaryEntry(entry);
    const contextExample = hasContext ? buildRequestContextExample(context!) : null;
    return {
      generic,
      response: withRequestContextExample(generic, contextExample),
    };
  }
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
      `You are an expert English-to-Chinese lexicographer and reading companion.`,
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
      `Translate the context sentence into natural Chinese (contextSentenceZh), and provide a brief (1-2 sentences) reading note (contextNote) explaining how "${entry.word}" functions or is nuanced in this context.`,
    ];

    const aiResult = await invokeAi({
      purpose: 'assist',
      source: 'dictionary:context',
      messages: [{ role: 'user', content: promptLines.join('\n') }],
      outputSchema: aiContextOnlyOutputSchema,
      timeoutMs: 15000,
    });

    return withRequestContextExample(
      generic,
      buildRequestContextExample(context, {
        sentenceZh: aiResult.content?.contextSentenceZh,
        note: aiResult.content?.contextNote,
      }),
    );
  } catch (error) {
    logger.warn({ err: error, word: entry.word }, 'AI dictionary context enrichment failed; returning sentence only');
    return withRequestContextExample(generic, buildRequestContextExample(context));
  }
}

export async function resolveWorkTitle(workId?: string): Promise<string | undefined> {
  if (!workId) {
    return undefined;
  }
  try {
    return await getPublishedWorkTitle(workId);
  } catch {
    return undefined;
  }
}

export async function attachContextForResponse(
  entry: DictionaryEntry,
  options: { contextSentence?: string; workId?: string; partId?: string },
  config: DictionaryConfigView,
): Promise<DictionaryEntry> {
  const sentence = options.contextSentence?.trim();
  if (!sentence) {
    return toGenericDictionaryEntry(entry);
  }

  const workTitle = await resolveWorkTitle(options.workId);
  const context: LookupContext = {
    sentence,
    workId: options.workId,
    partId: options.partId,
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
