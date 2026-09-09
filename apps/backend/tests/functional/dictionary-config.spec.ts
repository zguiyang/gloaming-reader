import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  dictionaryConfig as dictionaryConfigTable,
  dictionaryEntry as dictionaryEntryTable,
  user as userTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import {
  DICTIONARY_PROVIDER_FREE,
  DICTIONARY_PROVIDER_YOUDAO,
  type DictionaryConfigView,
  type TestDictionaryResult,
} from '@gloaming/shared/dictionary';

import app from '@/app';
import { db } from '@/db';
import * as redisLib from '@/lib/redis';
import { YoudaoDictionaryProvider } from '@/modules/dictionary/providers/youdao-dictionary';
import { DICTIONARY_CONFIG_ID } from '@/modules/dictionary/service';

const password = 'password123';

type DictionaryConfigRow = typeof dictionaryConfigTable.$inferSelect;

let priorConfig: DictionaryConfigRow | null | undefined;

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

async function setUserRole(email: string, role: string) {
  await db.update(userTable).set({ role }).where(eq(userTable.email, email));
}

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: role })).status).toBe(200);
  await markEmailVerified(email);
  if (role === 'admin') {
    await setUserRole(email, AUTH_ADMIN_ROLE);
  }
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  return { email, cookie: cookieHeader(login) };
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
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
    },
  };
}

async function restorePriorConfig(): Promise<void> {
  if (priorConfig === undefined) {
    return;
  }
  await db.delete(dictionaryConfigTable).where(eq(dictionaryConfigTable.id, DICTIONARY_CONFIG_ID));
  if (priorConfig) {
    await db.insert(dictionaryConfigTable).values(priorConfig);
  }
}

const createdLookupWords: string[] = [];

function trackLookupWord(word: string): string {
  const clean = word.trim().toLowerCase();
  createdLookupWords.push(clean);
  return clean;
}

async function cleanupCreatedLookupWords(): Promise<void> {
  const words = [...new Set(createdLookupWords)];
  createdLookupWords.length = 0;
  for (const word of words) {
    await db.delete(dictionaryEntryTable).where(eq(dictionaryEntryTable.word, word));
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isFreeDictionaryUrl(url: string): boolean {
  return url.includes('dictionaryapi.dev') || url.includes('/entries/en/');
}

function isYoudaoDictionaryUrl(url: string): boolean {
  return url.includes('dict.youdao.com') || url.includes('/jsonapi');
}

function youdaoSuccessPayload(word: string) {
  return {
    ec: {
      word: [
        {
          usphone: 'ˈfɔːlbæk',
          ukphone: 'ˈfɔːlbæk',
          trs: [{ tr: [{ l: { i: [`n. fallback gloss for ${word}`] } }] }],
        },
      ],
    },
    ee: {
      word: {
        trs: [{ pos: 'n.', tr: [{ l: { i: `a fallback definition for ${word}` } }] }],
      },
    },
  };
}

async function putDictionaryProvider(
  cookie: string,
  provider: typeof DICTIONARY_PROVIDER_FREE | typeof DICTIONARY_PROVIDER_YOUDAO,
): Promise<void> {
  const putRes = await app.request('/api/admin/dictionary/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      provider,
      isEnabled: true,
      enableAiEnrichment: false,
      timeoutMs: 5000,
      cacheTtlDays: 30,
    }),
  });
  expect(putRes.status).toBe(200);
}

beforeAll(async () => {
  const rows = await db
    .select()
    .from(dictionaryConfigTable)
    .where(eq(dictionaryConfigTable.id, DICTIONARY_CONFIG_ID))
    .limit(1);
  priorConfig = rows[0] ?? null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupCreatedLookupWords();
});

afterAll(async () => {
  await cleanupCreatedLookupWords();
  await restorePriorConfig();
});

describe('Dictionary config & lookup API', () => {
  it('protects admin routes from anonymous and normal users', async () => {
    const anonGet = await app.request('/api/admin/dictionary/config');
    expect(anonGet.status).toBe(401);

    const user = await createSession('user');
    const userGet = await app.request('/api/admin/dictionary/config', {
      headers: { Cookie: user.cookie },
    });
    expect(userGet.status).toBe(403);
  });

  it('allows admin to read default and updated configuration', async () => {
    const admin = await createSession('admin');

    const getRes = await app.request('/api/admin/dictionary/config', {
      headers: { Cookie: admin.cookie },
    });
    expect(getRes.status).toBe(200);
    const configView = (await getRes.json()) as DictionaryConfigView;
    expect(configView.provider).toBeDefined();

    // PUT updated configuration
    const putRes = await app.request('/api/admin/dictionary/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({
        provider: DICTIONARY_PROVIDER_FREE,
        isEnabled: true,
        enableAiEnrichment: false,
        timeoutMs: 6000,
        cacheTtlDays: 45,
        apiKey: 'secret-dict-api-key',
      }),
    });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as DictionaryConfigView;
    expect(updated.provider).toBe(DICTIONARY_PROVIDER_FREE);
    expect(updated.enableAiEnrichment).toBe(false);
    expect(updated.timeoutMs).toBe(6000);
    expect(updated.cacheTtlDays).toBe(45);
    expect(updated.apiKeySet).toBe(true);
    expect(updated.apiKeyMasked).toBeTruthy();
    expect(updated.apiKeyMasked).not.toBe('secret-dict-api-key');
  });

  it('runs dictionary test and performs multi-level caching', async () => {
    const admin = await createSession('admin');
    const memory = createMemoryRedis();
    vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            word: 'testword',
            phonetic: '/ˈtɛst.wɜːd/',
            phonetics: [{ text: '/ˈtɛst.wɜːd/', audio: 'https://example.com/test-us.mp3' }],
            meanings: [
              {
                partOfSpeech: 'noun',
                definitions: [{ definition: 'A word used in software testing' }],
              },
            ],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    // Admin test lookup
    const testRes = await app.request('/api/admin/dictionary/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({
        word: 'testword',
        contextSentence: 'This is a testword sentence.',
      }),
    });
    expect(testRes.status).toBe(200);
    const testData = (await testRes.json()) as TestDictionaryResult;
    expect(testData.ok).toBe(true);
    expect(testData.entry.word).toBe('testword');
    expect(testData.entry.meanings[0]?.partOfSpeech).toBe('noun');
    // Context may appear on the response when AI enrichment is enabled, but must never be cached.
    const cachedAfterTest = [...memory.store.entries()].find(([key]) => key.includes('gloaming:dictionary:v1:word:'));
    if (cachedAfterTest) {
      const cachedEntry = JSON.parse(cachedAfterTest[1]) as { contextExamples?: unknown[] };
      expect(cachedEntry.contextExamples == null || cachedEntry.contextExamples.length === 0).toBe(true);
    }

    // Guest user lookup without auth cookie
    const guestLookupRes = await app.request('/api/dictionary/lookup?word=testword');
    expect(guestLookupRes.status).toBe(200);
    const guestLookupData = (await guestLookupRes.json()) as {
      ok: boolean;
      entry: { word: string; fromCache?: boolean; contextExamples?: unknown[] };
    };
    expect(guestLookupData.ok).toBe(true);
    expect(guestLookupData.entry.word).toBe('testword');
    expect(guestLookupData.entry.fromCache).toBe(true);
    expect(guestLookupData.entry.contextExamples == null || guestLookupData.entry.contextExamples.length === 0).toBe(
      true,
    );
  });

  it('keeps lookup context request-scoped across two users for the same word', async () => {
    const memory = createMemoryRedis();
    vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    const admin = await createSession('admin');
    await putDictionaryProvider(admin.cookie, DICTIONARY_PROVIDER_FREE);

    const word = trackLookupWord(`ctx_iso_${Date.now().toString(36)}`);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            word,
            phonetics: [{ text: '/ˈtɛst/' }],
            meanings: [
              {
                partOfSpeech: 'noun',
                definitions: [{ definition: 'A shared dictionary gloss' }],
              },
            ],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const userA = await app.request(
      `/api/dictionary/lookup?word=${encodeURIComponent(word)}&contextSentence=${encodeURIComponent('User A private sentence.')}`,
    );
    expect(userA.status).toBe(200);
    const userABody = (await userA.json()) as {
      ok: boolean;
      entry: { contextExamples?: Array<{ sentence: string }> };
    };
    expect(userABody.ok).toBe(true);
    expect(userABody.entry.contextExamples?.[0]?.sentence).toBe('User A private sentence.');

    const cached = [...memory.store.entries()].find(([key]) => key.includes(`word:${encodeURIComponent(word)}`));
    expect(cached).toBeTruthy();
    const cachedEntry = JSON.parse(cached![1]) as { contextExamples?: unknown[] };
    expect(cachedEntry.contextExamples == null || cachedEntry.contextExamples.length === 0).toBe(true);

    const [dbRow] = await db
      .select({ contextExamples: dictionaryEntryTable.contextExamples })
      .from(dictionaryEntryTable)
      .where(eq(dictionaryEntryTable.word, word))
      .limit(1);
    expect(dbRow).toBeTruthy();
    expect(dbRow!.contextExamples).toEqual([]);

    const userB = await app.request(
      `/api/dictionary/lookup?word=${encodeURIComponent(word)}&contextSentence=${encodeURIComponent('User B different sentence.')}`,
    );
    expect(userB.status).toBe(200);
    const userBBody = (await userB.json()) as {
      ok: boolean;
      entry: { fromCache?: boolean; contextExamples?: Array<{ sentence: string }> };
    };
    expect(userBBody.ok).toBe(true);
    expect(userBBody.entry.fromCache).toBe(true);
    expect(userBBody.entry.contextExamples?.[0]?.sentence).toBe('User B different sentence.');
    expect(userBBody.entry.contextExamples?.[0]?.sentence).not.toBe(userABody.entry.contextExamples?.[0]?.sentence);

    const liveCached = memory.store.get(cached![0]);
    const liveEntry = JSON.parse(liveCached!) as { contextExamples?: unknown[] };
    expect(liveEntry.contextExamples == null || liveEntry.contextExamples.length === 0).toBe(true);
  });
  it('supports Youdao dictionary provider parsing', async () => {
    const admin = await createSession('admin');
    const memory = createMemoryRedis();
    vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);

    // Set provider to youdao
    await app.request('/api/admin/dictionary/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({
        provider: 'youdao',
        isEnabled: true,
        enableAiEnrichment: false,
      }),
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ec: {
            word: [
              {
                usphone: 'ˌserənˈdɪpəti',
                ukphone: 'ˌserənˈdɪpəti',
                trs: [{ tr: [{ l: { i: ['n. 意外发现美好事物的运气，机缘巧合'] } }] }],
              },
            ],
          },
          ee: {
            word: {
              trs: [{ pos: 'n.', tr: [{ l: { i: 'good luck in making unexpected discoveries' } }] }],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const testRes = await app.request('/api/admin/dictionary/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({
        word: 'serendipity',
      }),
    });
    expect(testRes.status).toBe(200);
    const testData = (await testRes.json()) as TestDictionaryResult;
    expect(testData.ok).toBe(true);
    expect(testData.entry.word).toBe('serendipity');
    expect(testData.entry.meanings[0]?.definitions[0]?.definitionZh).toContain('意外发现美好事物的运气');
  });

  it('falls back from Free transient transport failure to Youdao and returns Youdao entry source', async () => {
    const admin = await createSession('admin');
    const memory = createMemoryRedis();
    vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    await putDictionaryProvider(admin.cookie, DICTIONARY_PROVIDER_FREE);

    const word = trackLookupWord(`fb_ok_${Date.now().toString(36)}`);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (isFreeDictionaryUrl(url)) {
        throw new TypeError('fetch failed');
      }
      if (isYoudaoDictionaryUrl(url)) {
        return new Response(JSON.stringify(youdaoSuccessPayload(word)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch URL in fallback success test: ${url}`);
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);

    const testRes = await app.request('/api/admin/dictionary/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ word }),
    });
    expect(testRes.status).toBe(200);
    const testData = (await testRes.json()) as TestDictionaryResult;
    expect(testData.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(testData.entry.source).toBe(DICTIONARY_PROVIDER_YOUDAO);
    expect(testData.entry.meanings[0]?.definitions[0]?.definitionZh).toContain(`fallback gloss for ${word}`);
    // Configured primary remains Free; DB persistence uses config.provider (not asserted here).
    expect(testData.provider).toBe(DICTIONARY_PROVIDER_FREE);
  });

  it('does not call Youdao fallback when Free returns a payload error', async () => {
    const admin = await createSession('admin');
    const memory = createMemoryRedis();
    vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    await putDictionaryProvider(admin.cookie, DICTIONARY_PROVIDER_FREE);

    const word = trackLookupWord(`fb_payload_${Date.now().toString(36)}`);
    const youdaoLookup = vi.spyOn(YoudaoDictionaryProvider.prototype, 'lookup');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      expect(isFreeDictionaryUrl(url)).toBe(true);
      expect(isYoudaoDictionaryUrl(url)).toBe(false);
      return new Response(JSON.stringify({ not: 'an-array' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);

    const testRes = await app.request('/api/admin/dictionary/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ word }),
    });
    expect(testRes.status).toBe(400);
    const body = (await testRes.json()) as { error: string };
    expect(body.error).toMatch(/malformed response|must be an array/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(youdaoLookup).not.toHaveBeenCalled();
  });

  it('preserves primary Free error when Youdao fallback also fails', async () => {
    const admin = await createSession('admin');
    const memory = createMemoryRedis();
    vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    await putDictionaryProvider(admin.cookie, DICTIONARY_PROVIDER_FREE);

    const word = trackLookupWord(`fb_both_fail_${Date.now().toString(36)}`);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (isFreeDictionaryUrl(url) || isYoudaoDictionaryUrl(url)) {
        throw new TypeError('fetch failed');
      }
      throw new Error(`Unexpected fetch URL in fallback failure test: ${url}`);
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);

    const testRes = await app.request('/api/admin/dictionary/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ word }),
    });
    expect(testRes.status).toBe(502);
    const body = (await testRes.json()) as { error: string };
    expect(body.error).toMatch(/Free Dictionary API/i);
    expect(body.error).toMatch(/fetch failed/i);
    expect(body.error).not.toMatch(/Youdao Dictionary API/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not self-fallback when Youdao is the primary provider', async () => {
    const admin = await createSession('admin');
    const memory = createMemoryRedis();
    vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    await putDictionaryProvider(admin.cookie, DICTIONARY_PROVIDER_YOUDAO);

    const word = trackLookupWord(`yd_primary_${Date.now().toString(36)}`);
    const youdaoLookup = vi.spyOn(YoudaoDictionaryProvider.prototype, 'lookup');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      expect(isYoudaoDictionaryUrl(url)).toBe(true);
      throw new TypeError('fetch failed');
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);

    const testRes = await app.request('/api/admin/dictionary/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ word }),
    });
    expect(testRes.status).toBe(502);
    const body = (await testRes.json()) as { error: string };
    expect(body.error).toMatch(/Youdao Dictionary API/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(youdaoLookup).toHaveBeenCalledTimes(1);
  });
});
