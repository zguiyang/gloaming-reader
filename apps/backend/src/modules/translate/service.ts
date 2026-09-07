import { and, eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';
import {
  type BilingualCachePayload,
  bilingualCachePayloadSchema,
  type TranslatePartBody,
} from '@gloaming/shared/translate';

import { db } from '@/db';
import { NotFoundError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { composePromptMessages, PROMPT_ROLE, PROMPT_SCENE } from '@/lib/prompts';
import { getRedis } from '@/lib/redis';
import { streamAi } from '@/modules/ai';
import { reindexLeafParagraphOrdinals } from '@/modules/epub-ingest/clean';
import {
  createTranslateLineParser,
  formatSentenceListForPrompt,
  hashPartContent,
  splitPartSentences,
  type SplitSentence,
} from '@/modules/translate/split';

const translateLogger = rootLogger.child({ module: 'Translate' });

const BILINGUAL_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export type TranslateStreamMetaEvent = {
  type: 'meta';
  contentHash: string;
  titleEn: string;
  sentences: SplitSentence[];
};

export type TranslateStreamTitleEvent = {
  type: 'title';
  zh: string;
};

export type TranslateStreamSentenceEvent = {
  type: 'sentence';
  index: number;
  zh: string;
};

export type TranslateStreamDoneEvent = {
  type: 'done';
  contentHash: string;
  cached: boolean;
};

export type TranslateStreamEvent =
  TranslateStreamMetaEvent | TranslateStreamTitleEvent | TranslateStreamSentenceEvent | TranslateStreamDoneEvent;

export type StreamTranslatePartOptions = {
  signal?: AbortSignal;
};

function cacheKey(partId: string, contentHash: string): string {
  return `gloaming:bilingual:v3:${partId}:${contentHash}`;
}

function bilingualCacheMatch(partId: string): string {
  // Include legacy v2 keys so part updates invalidate stale bilingual caches.
  return `gloaming:bilingual:*:${partId}:*`;
}

export async function deleteBilingualCacheForPart(partId: string): Promise<void> {
  try {
    const redis = getRedis();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', bilingualCacheMatch(partId), 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    translateLogger.warn({ err: error, partId }, 'Redis bilingual cache delete failed');
  }
}

async function loadPublishedPart(partId: string): Promise<{ id: string; title: string; body: string }> {
  const rows = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
    })
    .from(readingPartTable)
    .innerJoin(readingWorkTable, eq(readingPartTable.workId, readingWorkTable.id))
    .where(and(eq(readingPartTable.id, partId), eq(readingWorkTable.status, 'published')))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Part not found');
  }
  return row;
}

async function readCache(partId: string, contentHash: string): Promise<BilingualCachePayload | null> {
  try {
    const raw = await getRedis().get(cacheKey(partId, contentHash));
    if (!raw) {
      return null;
    }
    const parsed = bilingualCachePayloadSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      translateLogger.warn({ partId, contentHash }, 'Invalid bilingual cache payload; ignoring');
      return null;
    }
    return parsed.data;
  } catch (error) {
    translateLogger.warn({ err: error, partId }, 'Redis bilingual cache read failed');
    return null;
  }
}

async function writeCache(partId: string, contentHash: string, payload: BilingualCachePayload): Promise<void> {
  try {
    await getRedis().set(cacheKey(partId, contentHash), JSON.stringify(payload), 'EX', BILINGUAL_CACHE_TTL_SECONDS);
  } catch (error) {
    translateLogger.warn({ err: error, partId }, 'Redis bilingual cache write failed');
  }
}

function* emitCachedPayload(contentHash: string, payload: BilingualCachePayload): Generator<TranslateStreamEvent> {
  yield {
    type: 'meta',
    contentHash,
    titleEn: payload.titleEn,
    sentences: payload.sentences.map(({ index, paragraphIndex, en }) => ({ index, paragraphIndex, en })),
  };
  yield { type: 'title', zh: payload.titleZh };
  for (const sentence of payload.sentences) {
    yield { type: 'sentence', index: sentence.index, zh: sentence.zh };
  }
  yield { type: 'done', contentHash, cached: true };
}

export async function* streamTranslatePart(
  _userId: string,
  body: TranslatePartBody,
  options: StreamTranslatePartOptions = {},
): AsyncGenerator<TranslateStreamEvent> {
  const part = await loadPublishedPart(body.partId);
  const readingBody = reindexLeafParagraphOrdinals(part.body);
  const contentHash = hashPartContent(part.title, part.body);
  const sentences = splitPartSentences(readingBody);

  const cached = await readCache(part.id, contentHash);
  if (cached) {
    yield* emitCachedPayload(contentHash, cached);
    return;
  }

  yield {
    type: 'meta',
    contentHash,
    titleEn: part.title,
    sentences,
  };

  if (sentences.length === 0 && !part.title.trim()) {
    yield { type: 'done', contentHash, cached: false };
    return;
  }

  const messages = await composePromptMessages({
    roleId: PROMPT_ROLE.languageTeacher,
    sceneId: PROMPT_SCENE.translatePart,
    actionId: 'translate',
    vars: {
      targetLanguage: 'English',
      replyLanguage: 'Chinese',
      titleEn: part.title,
      sentenceList: formatSentenceListForPrompt(sentences),
    },
  });

  const parser = createTranslateLineParser();
  let titleZh: string | null = null;
  const zhByIndex = new Map<number, string>();

  for await (const event of streamAi({
    purpose: 'translate',
    source: 'translate.part',
    userId: _userId,
    messages,
    signal: options.signal,
  })) {
    if (options.signal?.aborted) {
      return;
    }
    if (event.type === 'delta') {
      for (const line of parser.push(event.text)) {
        if (line.kind === 'title') {
          titleZh = line.zh;
          yield { type: 'title', zh: line.zh };
        } else {
          zhByIndex.set(line.index, line.zh);
          yield { type: 'sentence', index: line.index, zh: line.zh };
        }
      }
      continue;
    }

    for (const line of parser.flush()) {
      if (line.kind === 'title') {
        if (titleZh == null) {
          titleZh = line.zh;
          yield { type: 'title', zh: line.zh };
        }
      } else if (!zhByIndex.has(line.index)) {
        zhByIndex.set(line.index, line.zh);
        yield { type: 'sentence', index: line.index, zh: line.zh };
      }
    }
  }

  if (options.signal?.aborted) {
    return;
  }

  const resolvedTitleZh = titleZh?.trim() || part.title.trim() || '（无标题）';
  const assembled: BilingualCachePayload = {
    titleEn: part.title,
    titleZh: resolvedTitleZh,
    sentences: sentences.map((sentence) => {
      const zh = zhByIndex.get(sentence.index)?.trim();
      if (!zh) {
        throw new Error(`Missing translation for sentence ${sentence.index}`);
      }
      return { ...sentence, zh };
    }),
  };

  if (assembled.sentences.length === 0 && !titleZh?.trim() && !part.title.trim()) {
    yield { type: 'done', contentHash, cached: false };
    return;
  }

  if (titleZh == null && part.title.trim()) {
    yield { type: 'title', zh: resolvedTitleZh };
  }

  await writeCache(part.id, contentHash, assembled);
  yield { type: 'done', contentHash, cached: false };
}
