import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { llmAppSetting as llmAppSettingTable, llmProvider as llmProviderTable, user as userTable } from '@gloaming/db';
import type { LlmAppSettingView, LlmModel, LlmProvider } from '@gloaming/shared';
import { AI_PURPOSE_TO_SETTING_KEY } from '@gloaming/shared';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import * as aiService from '@/modules/ai/service';

const password = 'password123';
const ASSIST_SETTING_KEY = AI_PURPOSE_TO_SETTING_KEY.assist;

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

async function readAssistDefaultModelId(): Promise<string | null> {
  const rows = await db
    .select({ value: llmAppSettingTable.value })
    .from(llmAppSettingTable)
    .where(eq(llmAppSettingTable.key, ASSIST_SETTING_KEY))
    .limit(1);
  return rows[0]?.value ?? null;
}

/** Restore pre-test binding (or remove row if there was none). Does not wipe unrelated local config. */
async function restoreAssistDefaultModelId(priorModelRowId: string | null): Promise<void> {
  if (priorModelRowId) {
    await db
      .insert(llmAppSettingTable)
      .values({ key: ASSIST_SETTING_KEY, value: priorModelRowId })
      .onConflictDoUpdate({
        target: llmAppSettingTable.key,
        set: { value: priorModelRowId },
      });
    return;
  }
  await db.delete(llmAppSettingTable).where(eq(llmAppSettingTable.key, ASSIST_SETTING_KEY));
}

describe('LLM config HTTP', () => {
  const createdEmails: string[] = [];
  const createdProviderIds: string[] = [];
  /** Snapshot before this suite mutates purpose binding; undefined = never snapshotted / already restored. */
  let priorAssistModelRowId: string | null | undefined;

  afterAll(async () => {
    if (priorAssistModelRowId !== undefined) {
      await restoreAssistDefaultModelId(priorAssistModelRowId);
    }
    if (createdProviderIds.length > 0) {
      await db.delete(llmProviderTable).where(inArray(llmProviderTable.id, createdProviderIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('manages providers, models, settings without leaking API keys', async () => {
    const admin = await createSession('admin');
    createdEmails.push(admin.email);

    const createProvider = await app.request('/api/admin/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        apiFamily: 'openai',
        name: 'Test Gateway',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test-secret-abcdef',
      }),
    });
    expect(createProvider.status).toBe(201);
    const provider = (await createProvider.json()) as LlmProvider;
    createdProviderIds.push(provider.id);
    expect(provider.apiKeySet).toBe(true);
    expect(provider.apiKeyMasked).toContain('…');
    expect(JSON.stringify(provider)).not.toContain('sk-test-secret-abcdef');

    const createModel = await app.request('/api/admin/llm/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        providerId: provider.id,
        modelId: 'gpt-test',
        label: 'Test Model',
        temperature: 0.2,
      }),
    });
    expect(createModel.status).toBe(201);
    const model = (await createModel.json()) as LlmModel;
    expect(model.modelId).toBe('gpt-test');

    priorAssistModelRowId = await readAssistDefaultModelId();

    const putSetting = await app.request(`/api/admin/llm/settings/${ASSIST_SETTING_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ modelId: model.id }),
    });
    expect(putSetting.status).toBe(200);
    const setting = (await putSetting.json()) as LlmAppSettingView;
    expect(setting.healthy).toBe(true);
    expect(setting.modelId).toBe(model.id);

    const deleteModelBlocked = await app.request(`/api/admin/llm/models/${model.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(deleteModelBlocked.status).toBe(409);

    const invokeSpy = vi.spyOn(aiService, 'invokeAi').mockResolvedValue({
      content: 'ok',
      model: { rowId: model.id, label: model.label, modelId: model.modelId },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const testProvider = await app.request(`/api/admin/llm/providers/${provider.id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({}),
    });
    expect(testProvider.status).toBe(200);
    expect(invokeSpy).toHaveBeenCalled();
    invokeSpy.mockRestore();

    // Unbind test model without wiping the learner's prior purpose binding.
    await restoreAssistDefaultModelId(priorAssistModelRowId);
    priorAssistModelRowId = undefined;

    const deleteModel = await app.request(`/api/admin/llm/models/${model.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(deleteModel.status).toBe(204);

    const deleteProvider = await app.request(`/api/admin/llm/providers/${provider.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(deleteProvider.status).toBe(204);
    createdProviderIds.length = 0;
  });

  it('rejects cross-family wire variants and unimplemented runtime bindings', async () => {
    const admin = await createSession('admin');
    createdEmails.push(admin.email);

    const createOpenAi = await app.request('/api/admin/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        apiFamily: 'openai',
        name: 'OpenAI Family',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-openai-test',
      }),
    });
    expect(createOpenAi.status).toBe(201);
    const openAiProvider = (await createOpenAi.json()) as LlmProvider;
    createdProviderIds.push(openAiProvider.id);

    const invalidWire = await app.request('/api/admin/llm/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        providerId: openAiProvider.id,
        modelId: 'bad-wire',
        label: 'Bad Wire',
        wireVariant: 'messages',
      }),
    });
    expect(invalidWire.status).toBe(400);

    const createAnthropic = await app.request('/api/admin/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        apiFamily: 'anthropic',
        name: 'Anthropic Family',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test',
      }),
    });
    expect(createAnthropic.status).toBe(201);
    const anthropicProvider = (await createAnthropic.json()) as LlmProvider;
    createdProviderIds.push(anthropicProvider.id);
    expect(anthropicProvider.apiFamily).toBe('anthropic');

    const createAnthropicModel = await app.request('/api/admin/llm/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        providerId: anthropicProvider.id,
        modelId: 'claude-test',
        label: 'Claude Test',
        wireVariant: 'messages',
      }),
    });
    expect(createAnthropicModel.status).toBe(201);
    const anthropicModel = (await createAnthropicModel.json()) as LlmModel;

    const bindBlocked = await app.request(`/api/admin/llm/settings/${ASSIST_SETTING_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ modelId: anthropicModel.id }),
    });
    expect(bindBlocked.status).toBe(400);

    const testBlocked = await app.request(`/api/admin/llm/providers/${anthropicProvider.id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({}),
    });
    expect(testBlocked.status).toBe(503);

    const registry = await app.request('/api/admin/llm/wire-registry', {
      headers: { cookie: admin.cookie },
    });
    expect(registry.status).toBe(200);
    const registryBody = (await registry.json()) as { families: Array<{ id: string }> };
    expect(registryBody.families.map((family) => family.id)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'gemini']),
    );

    await app.request(`/api/admin/llm/models/${anthropicModel.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
  });
});
