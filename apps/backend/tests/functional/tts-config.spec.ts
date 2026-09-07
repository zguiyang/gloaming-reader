import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ttsConfig as ttsConfigTable, user as userTable } from '@gloaming/db';
import type { TestTtsResult, TtsConfigView } from '@gloaming/shared';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import { encryptApiKey } from '@/lib/llm';
import * as redisLib from '@/lib/redis';
import * as azureTts from '@/lib/tts/azure';
import * as ttsService from '@/modules/tts/service';
import { TTS_CONFIG_ID } from '@/modules/tts/service';

const password = 'password123';

type TtsConfigRow = typeof ttsConfigTable.$inferSelect;

/** Snapshot of local/dev `tts_config` before this suite mutates the singleton row. */
let priorConfig: TtsConfigRow | null | undefined;

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
    },
  };
}

/** Restore pre-suite singleton (or remove if there was none). Does not wipe unrelated tables. */
async function restorePriorConfig(): Promise<void> {
  if (priorConfig === undefined) {
    return;
  }
  await db.delete(ttsConfigTable).where(eq(ttsConfigTable.id, TTS_CONFIG_ID));
  if (priorConfig) {
    await db.insert(ttsConfigTable).values(priorConfig);
  }
}

beforeAll(async () => {
  const rows = await db.select().from(ttsConfigTable).where(eq(ttsConfigTable.id, TTS_CONFIG_ID)).limit(1);
  priorConfig = rows[0] ?? null;
});

afterAll(async () => {
  await restorePriorConfig();
});

describe('admin TTS config', () => {
  it('rejects non-admin, upserts config, and tests with mocked Azure TTS', async () => {
    const user = await createSession('user');
    const admin = await createSession('admin');

    const forbidden = await app.request('/api/admin/tts/config', {
      headers: { Cookie: user.cookie },
    });
    expect(forbidden.status).toBe(403);

    // Isolate empty-state assertion without permanently discarding local config (restored in afterAll).
    await db.delete(ttsConfigTable).where(eq(ttsConfigTable.id, TTS_CONFIG_ID));

    const empty = await app.request('/api/admin/tts/config', {
      headers: { Cookie: admin.cookie },
    });
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as TtsConfigView;
    expect(emptyBody.configured).toBe(false);
    expect(emptyBody.apiKeySet).toBe(false);

    const missingKey = await app.request('/api/admin/tts/config', {
      method: 'PUT',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: 'eastasia',
        isEnabled: true,
        defaultVoice: 'en-US-JennyNeural',
        usVoice: 'en-US-JennyNeural',
        ukVoice: 'en-GB-SoniaNeural',
      }),
    });
    expect(missingKey.status).toBe(400);

    const saved = await app.request('/api/admin/tts/config', {
      method: 'PUT',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: 'eastasia',
        apiKey: 'test-azure-speech-key',
        isEnabled: true,
        defaultVoice: 'en-US-JennyNeural',
        usVoice: 'en-US-GuyNeural',
        ukVoice: 'en-GB-SoniaNeural',
      }),
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as TtsConfigView;
    expect(savedBody.configured).toBe(true);
    expect(savedBody.apiKeySet).toBe(true);
    expect(savedBody.apiKeyMasked).toBeTruthy();
    expect(savedBody.apiKeyMasked).not.toContain('test-azure-speech-key');
    expect(savedBody.usVoice).toBe('en-US-GuyNeural');

    const updated = await app.request('/api/admin/tts/config', {
      method: 'PUT',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: 'eastus',
        isEnabled: true,
        defaultVoice: 'en-US-JennyNeural',
        usVoice: 'en-US-GuyNeural',
        ukVoice: 'en-GB-RyanNeural',
      }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as TtsConfigView;
    expect(updatedBody.region).toBe('eastus');
    expect(updatedBody.ukVoice).toBe('en-GB-RyanNeural');

    const presets = await app.request('/api/admin/tts/voice-presets', {
      headers: { Cookie: admin.cookie },
    });
    expect(presets.status).toBe(200);
    const presetBody = (await presets.json()) as Array<{ voice: string }>;
    expect(presetBody.length).toBeGreaterThan(0);

    const synthesizeSpy = vi.spyOn(azureTts, 'synthesizeAzureTts').mockResolvedValue({
      audio: Buffer.from('fake-mp3'),
      mimeType: 'audio/mpeg',
      wordTimings: [{ text: 'hello', audioOffsetMs: 0, durationMs: 200, textOffset: 0 }],
    });

    const tested = await app.request('/api/admin/tts/test', {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello', role: 'us' }),
    });
    expect(tested.status).toBe(200);
    const testBody = (await tested.json()) as TestTtsResult;
    expect(testBody.ok).toBe(true);
    expect(testBody.voice).toBe('en-US-GuyNeural');
    expect(testBody.mimeType).toBe('audio/mpeg');
    expect(testBody.audioBase64).toBe(Buffer.from('fake-mp3').toString('base64'));
    expect(testBody.latencyMs).toBeGreaterThanOrEqual(0);
    expect(synthesizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'eastus',
        voice: 'en-US-GuyNeural',
        text: 'hello',
        subscriptionKey: 'test-azure-speech-key',
      }),
    );

    synthesizeSpy.mockRestore();
  });

  it('caches successful synthesis for reuse and lets admin test bypass cache', async () => {
    const admin = await createSession('admin');
    await db
      .insert(ttsConfigTable)
      .values({
        id: TTS_CONFIG_ID,
        provider: 'azure',
        region: 'eastasia',
        apiKeyCiphertext: encryptApiKey('cache-secret-key'),
        isEnabled: true,
        defaultVoice: 'en-US-JennyNeural',
        usVoice: 'en-US-JennyNeural',
        ukVoice: 'en-GB-SoniaNeural',
      })
      .onConflictDoUpdate({
        target: ttsConfigTable.id,
        set: {
          region: 'eastasia',
          apiKeyCiphertext: encryptApiKey('cache-secret-key'),
          isEnabled: true,
          defaultVoice: 'en-US-JennyNeural',
          usVoice: 'en-US-JennyNeural',
          ukVoice: 'en-GB-SoniaNeural',
        },
      });

    const memory = createMemoryRedis();
    const redisSpy = vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    const synthesizeSpy = vi.spyOn(azureTts, 'synthesizeAzureTts').mockResolvedValue({
      audio: Buffer.from('cached-mp3'),
      mimeType: 'audio/mpeg',
      wordTimings: [{ text: 'hello', audioOffsetMs: 0, durationMs: 120, textOffset: 0 }],
    });

    const first = await ttsService.synthesizeTts({
      text: '  hello   world  ',
      source: 'test.cache',
    });
    expect(first.cached).toBe(false);
    expect(first.audio.toString()).toBe('cached-mp3');
    expect(synthesizeSpy).toHaveBeenCalledTimes(1);
    expect(memory.client.set).toHaveBeenCalled();

    synthesizeSpy.mockClear();
    const second = await ttsService.synthesizeTts({
      text: 'hello world',
      source: 'test.cache',
    });
    expect(second.cached).toBe(true);
    expect(second.audio.toString()).toBe('cached-mp3');
    expect(synthesizeSpy).not.toHaveBeenCalled();

    synthesizeSpy.mockClear();
    const tested = await app.request('/api/admin/tts/test', {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello world' }),
    });
    expect(tested.status).toBe(200);
    expect(synthesizeSpy).toHaveBeenCalledTimes(1);

    synthesizeSpy.mockRestore();
    redisSpy.mockRestore();
  });
});
