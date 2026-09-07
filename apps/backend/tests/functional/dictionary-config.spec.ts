import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { dictionaryConfig as dictionaryConfigTable, user as userTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import {
  DICTIONARY_PROVIDER_FREE,
  type DictionaryConfigView,
  type TestDictionaryResult,
} from '@gloaming/shared/dictionary';

import app from '@/app';
import { db } from '@/db';
import * as redisLib from '@/lib/redis';
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

beforeAll(async () => {
  const rows = await db
    .select()
    .from(dictionaryConfigTable)
    .where(eq(dictionaryConfigTable.id, DICTIONARY_CONFIG_ID))
    .limit(1);
  priorConfig = rows[0] ?? null;
});

afterAll(async () => {
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

    // Guest user lookup without auth cookie
    const guestLookupRes = await app.request('/api/dictionary/lookup?word=testword');
    expect(guestLookupRes.status).toBe(200);
    const guestLookupData = (await guestLookupRes.json()) as {
      ok: boolean;
      entry: { word: string; fromCache?: boolean };
    };
    expect(guestLookupData.ok).toBe(true);
    expect(guestLookupData.entry.word).toBe('testword');
    expect(guestLookupData.entry.fromCache).toBe(true);
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
});
