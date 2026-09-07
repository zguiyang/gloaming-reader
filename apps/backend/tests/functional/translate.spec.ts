import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { readingPart as readingPartTable, readingWork as readingWorkTable, user as userTable } from '@gloaming/db';
import {
  TRANSLATE_SSE_EVENT,
  type TranslateSseDone,
  type TranslateSseMeta,
  type TranslateSseSentence,
  type TranslateSseTitle,
} from '@gloaming/shared/translate';

import app from '@/app';
import { db } from '@/db';
import * as redisLib from '@/lib/redis';
import * as aiService from '@/modules/ai/service';
import { hashPartContent } from '@/modules/translate/split';

const password = 'password123';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) {
    return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  }
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}

async function signUp(input: { email: string; username: string; name: string }) {
  return app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({
      email: input.email,
      password,
      name: input.name,
      username: input.username,
    }),
  });
}

async function markEmailVerified(email: string) {
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
}

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

async function createSession() {
  const email = uniqueEmail('translate');
  const username = `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: 'translate' })).status).toBe(200);
  await markEmailVerified(email);
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  return { email, cookie: cookieHeader(login) };
}

type ParsedSse = { event?: string; data: string };

function parseSseBlocks(raw: string): ParsedSse[] {
  const blocks = raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }
    return { event, data: dataLines.join('\n') };
  });
}

function createMemoryRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    },
  };
}

async function* translateStream(): AsyncGenerator<aiService.AiStreamEvent> {
  yield { type: 'delta', text: 'TITLE\t狐狸测试\n' };
  yield { type: 'delta', text: '0\t狐狸跳过了懒狗。\n' };
  yield {
    type: 'done',
    content: 'TITLE\t狐狸测试\n0\t狐狸跳过了懒狗。\n',
    model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

describe('Translate HTTP', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];

  afterAll(async () => {
    if (createdWorkIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('streams meta/title/sentence then caches for a second request', async () => {
    const user = await createSession();
    createdEmails.push(user.email);

    const workId = `work_tr_${Date.now().toString(36)}`;
    const partId = `part_tr_${Date.now().toString(36)}`;
    createdWorkIds.push(workId);
    const title = 'Fox Test';
    const body = 'The fox jumped over the lazy dog.';
    await db.insert(readingWorkTable).values({
      id: workId,
      title,
      status: 'published',
      publishedAt: new Date(),
    });
    await db.insert(readingPartTable).values({
      id: partId,
      workId,
      sortOrder: 0,
      kind: 'body',
      title,
      body,
    });

    const memory = createMemoryRedis();
    const redisSpy = vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    const streamSpy = vi.spyOn(aiService, 'streamAi').mockImplementation(() => translateStream());

    const first = await app.request('/api/translate/part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({ partId }),
    });
    expect(first.status).toBe(200);
    const firstEvents = parseSseBlocks(await first.text());
    expect(firstEvents.map((e) => e.event)).toEqual([
      TRANSLATE_SSE_EVENT.meta,
      TRANSLATE_SSE_EVENT.title,
      TRANSLATE_SSE_EVENT.sentence,
      TRANSLATE_SSE_EVENT.done,
    ]);

    const meta = JSON.parse(firstEvents[0]!.data) as TranslateSseMeta;
    expect(meta.contentHash).toBe(hashPartContent(title, body));
    expect(meta.sentences).toHaveLength(1);
    expect(meta.sentences[0]?.en).toContain('fox');

    const titleEvent = JSON.parse(firstEvents[1]!.data) as TranslateSseTitle;
    expect(titleEvent.zh).toBe('狐狸测试');
    const sentenceEvent = JSON.parse(firstEvents[2]!.data) as TranslateSseSentence;
    expect(sentenceEvent).toEqual({ index: 0, zh: '狐狸跳过了懒狗。' });

    const done = JSON.parse(firstEvents[3]!.data) as TranslateSseDone;
    expect(done.cached).toBe(false);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(memory.client.set).toHaveBeenCalled();

    streamSpy.mockClear();
    const second = await app.request('/api/translate/part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({ partId }),
    });
    expect(second.status).toBe(200);
    const secondEvents = parseSseBlocks(await second.text());
    expect(secondEvents.map((e) => e.event)).toEqual([
      TRANSLATE_SSE_EVENT.meta,
      TRANSLATE_SSE_EVENT.title,
      TRANSLATE_SSE_EVENT.sentence,
      TRANSLATE_SSE_EVENT.done,
    ]);
    const secondDone = JSON.parse(secondEvents[3]!.data) as TranslateSseDone;
    expect(secondDone.cached).toBe(true);
    expect(streamSpy).not.toHaveBeenCalled();

    await db.update(readingPartTable).set({ body: 'The fox slept.' }).where(eq(readingPartTable.id, partId));
    streamSpy.mockImplementation(() => translateStream());
    const third = await app.request('/api/translate/part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({ partId }),
    });
    expect(third.status).toBe(200);
    const thirdEvents = parseSseBlocks(await third.text());
    const thirdDone = JSON.parse(
      thirdEvents.find((e) => e.event === TRANSLATE_SSE_EVENT.done)!.data,
    ) as TranslateSseDone;
    expect(thirdDone.cached).toBe(false);
    expect(streamSpy).toHaveBeenCalledTimes(1);

    streamSpy.mockRestore();
    redisSpy.mockRestore();
  });
});
