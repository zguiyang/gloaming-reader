import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
  ttsConfig as ttsConfigTable,
  user as userTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import type { LlmProvider } from '@gloaming/shared/llm';
import { AI_PURPOSE_TO_SETTING_KEY } from '@gloaming/shared/llm';

import app from '@/app';
import { invokeAi } from '@/domains/ai';
import * as invocationLog from '@/domains/ai/invocations/log';
import * as purposeModel from '@/domains/ai/runtime/purpose-model';
import { resolveModelRowId } from '@/domains/ai/runtime/purpose-model';
import { db } from '@/infra/db';
import * as llmInfra from '@/infra/llm';
import { encryptApiKey } from '@/infra/llm';
import { ERROR_CODES } from '@/shared/errors/codes';

vi.mock('@/infra/auth/mail', () => ({
  buildVerificationUrl: (token: string) => `http://localhost:3000/verify-email?token=${encodeURIComponent(token)}`,
  logDevAuthLink: vi.fn(),
  sendAuthMail: vi.fn().mockResolvedValue(undefined),
}));

const password = 'password123';
const ASSIST_KEY = AI_PURPOSE_TO_SETTING_KEY.assist;

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
    body: JSON.stringify({ email: input.email, password, name: input.name, username: input.username }),
  });
}

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}`;
  expect((await signUp({ email, username, name: role })).status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  if (role === 'admin') {
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
  }
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  const userRow = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: userRow[0]!.id };
}

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

describe('user-first provider resolver', () => {
  const createdEmails: string[] = [];
  const createdProviderIds: string[] = [];
  const createdModelIds: string[] = [];
  const createdSettingIds: string[] = [];
  const createdTtsIds: string[] = [];

  afterAll(async () => {
    if (createdSettingIds.length) {
      await db.delete(llmAppSettingTable).where(inArray(llmAppSettingTable.id, createdSettingIds));
    }
    if (createdModelIds.length) {
      await db.delete(llmModelTable).where(inArray(llmModelTable.id, createdModelIds));
    }
    if (createdProviderIds.length) {
      await db.delete(llmProviderTable).where(inArray(llmProviderTable.id, createdProviderIds));
    }
    if (createdTtsIds.length) {
      await db.delete(ttsConfigTable).where(inArray(ttsConfigTable.id, createdTtsIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('isolates admin provider APIs to instance scope', async () => {
    const user = await createSession('user');
    const admin = await createSession('admin');
    createdEmails.push(user.email, admin.email);

    const userProviderRes = await app.request('/api/settings/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: user.cookie },
      body: JSON.stringify({
        apiFamily: 'openai',
        name: 'User Private Gateway',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-user-scope-key',
      }),
    });
    expect(userProviderRes.status).toBe(201);
    const userProvider = (await userProviderRes.json()) as LlmProvider;
    createdProviderIds.push(userProvider.id);

    const adminList = (await (
      await app.request('/api/admin/llm/providers', { headers: { cookie: admin.cookie } })
    ).json()) as LlmProvider[];
    expect(adminList.some((p) => p.id === userProvider.id)).toBe(false);

    const adminPatch = await app.request(`/api/admin/llm/providers/${userProvider.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ name: 'Hijack' }),
    });
    expect(adminPatch.status).toBe(404);
  });

  it('masks secrets on user provider APIs and blocks cross-user access', async () => {
    const userA = await createSession('user');
    const userB = await createSession('user');
    createdEmails.push(userA.email, userB.email);

    const createOk = await app.request('/api/settings/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: userA.cookie },
      body: JSON.stringify({
        apiFamily: 'openai',
        name: 'User A Gateway',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-user-a-secret',
        ownerUserId: userB.userId,
      }),
    });
    expect(createOk.status).toBe(201);
    const provider = (await createOk.json()) as LlmProvider;
    createdProviderIds.push(provider.id);
    expect(JSON.stringify(provider)).not.toContain('sk-user-a-secret');

    const userBList = (await (
      await app.request('/api/settings/llm/providers', { headers: { cookie: userB.cookie } })
    ).json()) as LlmProvider[];
    expect(userBList.some((item) => item.id === provider.id)).toBe(false);

    const crossUpdate = await app.request(`/api/settings/llm/providers/${provider.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: userB.cookie },
      body: JSON.stringify({ name: 'Hijack' }),
    });
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await app.request(`/api/settings/llm/providers/${provider.id}`, {
      method: 'DELETE',
      headers: { cookie: userB.cookie },
    });
    expect(crossDelete.status).toBe(404);

    const foreignModel = await app.request('/api/settings/llm/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: userB.cookie },
      body: JSON.stringify({
        providerId: provider.id,
        modelId: 'foreign-model',
        label: 'Foreign model',
        isEnabled: true,
        sortOrder: 0,
      }),
    });
    expect(foreignModel.status).toBe(404);
  });

  it('isolates user TTS configuration and masks its secret', async () => {
    const userA = await createSession('user');
    const userB = await createSession('user');
    createdEmails.push(userA.email, userB.email);

    const saved = await app.request('/api/settings/tts/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: userA.cookie },
      body: JSON.stringify({
        region: 'eastus',
        apiKey: 'sk-user-tts-secret',
        isEnabled: true,
        defaultVoice: 'en-US-JennyNeural',
        usVoice: 'en-US-JennyNeural',
        ukVoice: 'en-GB-SoniaNeural',
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain('sk-user-tts-secret');
    const userTts = await db
      .select({ id: ttsConfigTable.id })
      .from(ttsConfigTable)
      .where(eq(ttsConfigTable.ownerUserId, userA.userId));
    createdTtsIds.push(...userTts.map((row) => row.id));

    const userBConfig = await app.request('/api/settings/tts/config', { headers: { cookie: userB.cookie } });
    expect(userBConfig.status).toBe(200);
    expect(await userBConfig.json()).toMatchObject({ configured: false, apiKeySet: false });
  });

  it('prefers user assist binding over instance at resolve time', async () => {
    const user = await createSession('user');
    const otherUser = await createSession('user');
    createdEmails.push(user.email, otherUser.email);

    const instanceProviderId = randomUUID();
    const userProviderId = randomUUID();
    const instanceModelId = randomUUID();
    const userModelId = randomUUID();
    createdProviderIds.push(instanceProviderId, userProviderId);
    createdModelIds.push(instanceModelId, userModelId);

    await db.insert(llmProviderTable).values([
      {
        id: instanceProviderId,
        name: `inst-${randomUUID().slice(0, 6)}`,
        apiFamily: 'openai',
        baseUrl: 'https://example.com/v1',
        apiKeyCiphertext: encryptApiKey('sk-inst'),
        ownerUserId: null,
        isEnabled: true,
      },
      {
        id: userProviderId,
        name: `usr-${randomUUID().slice(0, 6)}`,
        apiFamily: 'openai',
        baseUrl: 'https://example.com/v1',
        apiKeyCiphertext: encryptApiKey('sk-user'),
        ownerUserId: user.userId,
        isEnabled: true,
      },
    ]);
    await db.insert(llmModelTable).values([
      {
        id: instanceModelId,
        providerId: instanceProviderId,
        modelId: 'inst',
        label: 'Inst',
        wireVariant: 'chat-completions',
        isEnabled: true,
      },
      {
        id: userModelId,
        providerId: userProviderId,
        modelId: 'user',
        label: 'User',
        wireVariant: 'chat-completions',
        isEnabled: true,
      },
    ]);

    const instanceSettingId = randomUUID();
    const userSettingId = randomUUID();
    createdSettingIds.push(instanceSettingId, userSettingId);
    await db.insert(llmAppSettingTable).values([
      { id: instanceSettingId, key: ASSIST_KEY, value: instanceModelId, ownerUserId: null },
      { id: userSettingId, key: ASSIST_KEY, value: userModelId, ownerUserId: user.userId },
    ]);

    const resolvedForUser = await resolveModelRowId({ purpose: 'assist', userId: user.userId });
    expect(resolvedForUser).toBe(userModelId);

    const resolvedAnon = await resolveModelRowId({ purpose: 'assist' });
    expect(resolvedAnon).toBe(instanceModelId);
    const resolvedForOtherUser = await resolveModelRowId({ purpose: 'assist', userId: otherUser.userId });
    expect(resolvedForOtherUser).toBe(instanceModelId);
  });

  it('does not re-resolve model after upstream client failure', async () => {
    const purposeSpy = vi.spyOn(purposeModel, 'resolveModelRowId');
    purposeSpy.mockResolvedValue('model-row-fixed');

    vi.spyOn(llmInfra, 'resolveLlmByModelRowId').mockResolvedValue({
      modelRowId: 'model-row-fixed',
      providerId: 'provider',
      providerName: 'p',
      apiFamily: 'openai',
      wireVariant: 'chat-completions',
      label: 'L',
      modelId: 'm',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk',
      proxyUrl: null,
      thinkingParam: null,
      temperature: null,
      maxTokens: null,
    });
    vi.spyOn(llmInfra, 'createLlmClient').mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error('upstream 5xx')),
    } as never);
    vi.spyOn(invocationLog, 'recordInvocation').mockResolvedValue(undefined);

    await expect(
      invokeAi({
        purpose: 'assist',
        userId: 'user-pr06-runtime-failure',
        source: 'test.no-fallback',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.AI.UNAVAILABLE });

    expect(purposeSpy).toHaveBeenCalledTimes(1);
    expect(llmInfra.resolveLlmByModelRowId).toHaveBeenCalledTimes(1);
    purposeSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
