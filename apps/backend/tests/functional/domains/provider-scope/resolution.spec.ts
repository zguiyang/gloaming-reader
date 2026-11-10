import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
  ttsConfig as ttsConfigTable,
  user as userTable,
} from '@gloaming/db';
import { AI_PURPOSE_TO_SETTING_KEY, type AiSettingKey } from '@gloaming/shared/llm';

import {
  resolveScopedAppSettingValue,
  resolveScopedTtsConfigRow,
  selectUsableTtsConfig,
} from '@/domains/provider-scope';
import { db } from '@/infra/db';
import { encryptApiKey } from '@/infra/llm';

const providerStub = {
  apiFamily: 'openai',
  baseUrl: 'https://example.com/v1',
  apiKeyCiphertext: encryptApiKey('sk-pr06-resolution-test'),
  isEnabled: true,
};

const ttsStub = {
  provider: 'azure',
  region: 'eastus',
  apiKeyCiphertext: encryptApiKey('sk-pr06-resolution-test'),
  isEnabled: true,
  defaultVoice: 'en-US-JennyNeural',
  usVoice: 'en-US-JennyNeural',
  ukVoice: 'en-GB-SoniaNeural',
};

describe('provider-scope resolution', () => {
  const providerIds: string[] = [];
  const modelIds: string[] = [];
  const settingIds: string[] = [];
  const ttsIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    if (settingIds.length) {
      await db.delete(llmAppSettingTable).where(inArray(llmAppSettingTable.id, settingIds));
    }
    for (const id of modelIds) {
      await db.delete(llmModelTable).where(eq(llmModelTable.id, id));
    }
    for (const id of providerIds) {
      await db.delete(llmProviderTable).where(eq(llmProviderTable.id, id));
    }
    for (const id of ttsIds) {
      await db.delete(ttsConfigTable).where(eq(ttsConfigTable.id, id));
    }
  });

  it('resolves app settings user-first then instance for authenticated actor', async () => {
    const userId = randomUUID();
    userIds.push(userId);
    await db.insert(userTable).values({
      id: userId,
      name: 'PR-06 resolver test user',
      email: `pr06-${userId}@example.com`,
      emailVerified: true,
    });
    const instanceProviderId = randomUUID();
    const userProviderId = randomUUID();
    const instanceModelId = randomUUID();
    const userModelId = randomUUID();
    providerIds.push(instanceProviderId, userProviderId);
    modelIds.push(instanceModelId, userModelId);

    await db.insert(llmProviderTable).values([
      { id: instanceProviderId, name: `inst-${randomUUID().slice(0, 6)}`, ...providerStub, ownerUserId: null },
      { id: userProviderId, name: `usr-${randomUUID().slice(0, 6)}`, ...providerStub, ownerUserId: userId },
    ]);
    await db.insert(llmModelTable).values([
      {
        id: instanceModelId,
        providerId: instanceProviderId,
        modelId: 'inst-model',
        label: 'Instance',
        wireVariant: 'chat-completions',
      },
      {
        id: userModelId,
        providerId: userProviderId,
        modelId: 'user-model',
        label: 'User',
        wireVariant: 'chat-completions',
      },
    ]);

    const key = AI_PURPOSE_TO_SETTING_KEY.assist;
    const instanceSettingId = randomUUID();
    const userSettingId = randomUUID();
    settingIds.push(instanceSettingId, userSettingId);
    await db.insert(llmAppSettingTable).values([
      { id: instanceSettingId, key, value: instanceModelId, ownerUserId: null },
      { id: userSettingId, key, value: userModelId, ownerUserId: userId },
    ]);

    const resolvedUser = await resolveScopedAppSettingValue(key, { kind: 'authenticated', userId });
    expect(resolvedUser).toBe(userModelId);

    const resolvedAnon = await resolveScopedAppSettingValue(key, { kind: 'anonymous' });
    expect(resolvedAnon).toBe(instanceModelId);

    await db.update(llmModelTable).set({ isEnabled: false }).where(eq(llmModelTable.id, userModelId));
    const resolvedWithDisabledUserModel = await resolveScopedAppSettingValue(key, { kind: 'authenticated', userId });
    expect(resolvedWithDisabledUserModel).toBe(instanceModelId);

    await db.update(llmModelTable).set({ isEnabled: true }).where(eq(llmModelTable.id, userModelId));
    await db
      .update(llmProviderTable)
      .set({ apiKeyCiphertext: 'not-encrypted' })
      .where(eq(llmProviderTable.id, userProviderId));
    const resolvedWithInvalidUserCredential = await resolveScopedAppSettingValue(key, {
      kind: 'authenticated',
      userId,
    });
    expect(resolvedWithInvalidUserCredential).toBe(instanceModelId);

    const noConfig = await resolveScopedAppSettingValue(`pr06-missing-${randomUUID()}` as AiSettingKey, {
      kind: 'anonymous',
    });
    expect(noConfig).toBeNull();
  });

  it('resolves TTS config user-first then instance', async () => {
    const userId = randomUUID();
    userIds.push(userId);
    await db.insert(userTable).values({
      id: userId,
      name: 'PR-06 TTS resolver test user',
      email: `pr06-tts-${userId}@example.com`,
      emailVerified: true,
    });
    const userTtsId = randomUUID();
    ttsIds.push(userTtsId);
    await db.insert(ttsConfigTable).values({ id: userTtsId, ownerUserId: userId, ...ttsStub, region: 'user-region' });

    const userRow = await resolveScopedTtsConfigRow({ kind: 'authenticated', userId });
    expect(userRow?.region).toBe('user-region');

    const anonRow = await resolveScopedTtsConfigRow({ kind: 'anonymous' });
    expect(anonRow).toBeNull();
    const otherUserRow = await resolveScopedTtsConfigRow({ kind: 'authenticated', userId: randomUUID() });
    expect(otherUserRow).toBeNull();

    const instanceRow = { ...userRow!, id: randomUUID(), ownerUserId: null, region: 'instance-region' };
    expect(selectUsableTtsConfig(userRow, instanceRow)).toBe(userRow);
    const invalidUserRow = { ...userRow!, isEnabled: false };
    expect(selectUsableTtsConfig(invalidUserRow, instanceRow)).toBe(instanceRow);
    const invalidCredentialRow = { ...userRow!, apiKeyCiphertext: 'not-encrypted' };
    expect(selectUsableTtsConfig(invalidCredentialRow, instanceRow)).toBe(instanceRow);
    expect(selectUsableTtsConfig(null, null)).toBeNull();
  });
});
