import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { llmModel as llmModelTable, llmProvider as llmProviderTable, user as userTable } from '@gloaming/db';

import { db } from '@/infra/db';
import { encryptApiKey, resolveLlmByModelRowId } from '@/infra/llm';
import { AppError } from '@/shared/errors/app-error';

describe('resolveLlmByModelRowId', () => {
  const providerId = randomUUID();
  const modelId = randomUUID();
  const instanceProviderId = randomUUID();
  const userProviderId = randomUUID();
  const userModelId = randomUUID();
  const userId = `resolve-proxy-user-${randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await db
      .delete(llmProviderTable)
      .where(inArray(llmProviderTable.id, [providerId, instanceProviderId, userProviderId]));
    await db.delete(userTable).where(eq(userTable.id, userId));
  });

  it('rejects disabled provider or model', async () => {
    await db.insert(llmProviderTable).values({
      id: providerId,
      apiFamily: 'openai',
      name: 'resolve-test',
      baseUrl: 'https://example.com/v1',
      apiKeyCiphertext: encryptApiKey('sk-resolve-test'),
      isEnabled: true,
    });
    await db.insert(llmModelTable).values({
      id: modelId,
      providerId,
      modelId: 'm-disabled',
      label: 'Disabled',
      wireVariant: 'chat-completions',
      isEnabled: false,
    });

    await expect(resolveLlmByModelRowId(modelId)).rejects.toBeInstanceOf(AppError);

    await db.update(llmModelTable).set({ isEnabled: true }).where(eq(llmModelTable.id, modelId));
    await db.update(llmProviderTable).set({ isEnabled: false }).where(eq(llmProviderTable.id, providerId));
    await expect(resolveLlmByModelRowId(modelId)).rejects.toBeInstanceOf(AppError);
  });

  it('inherits instance proxyUrl for a user provider that omits proxy on the same base URL', async () => {
    await db.insert(userTable).values({
      id: userId,
      name: 'Resolve Proxy User',
      email: `${userId}@example.com`,
      emailVerified: true,
      username: userId,
      displayUsername: userId,
    });
    await db.insert(llmProviderTable).values({
      id: instanceProviderId,
      apiFamily: 'openai',
      name: 'resolve-instance-proxy',
      baseUrl: 'https://proxy-inherit.example/v1/',
      proxyUrl: 'http://127.0.0.1:7897',
      apiKeyCiphertext: encryptApiKey('sk-instance-proxy'),
      isEnabled: true,
    });
    await db.insert(llmProviderTable).values({
      id: userProviderId,
      ownerUserId: userId,
      apiFamily: 'openai',
      name: 'resolve-user-no-proxy',
      baseUrl: 'https://proxy-inherit.example/v1',
      proxyUrl: null,
      apiKeyCiphertext: encryptApiKey('sk-user-proxy'),
      isEnabled: true,
    });
    await db.insert(llmModelTable).values({
      id: userModelId,
      providerId: userProviderId,
      modelId: 'm-user',
      label: 'User model',
      wireVariant: 'chat-completions',
      isEnabled: true,
    });

    const resolved = await resolveLlmByModelRowId(userModelId);
    expect(resolved.proxyUrl).toBe('http://127.0.0.1:7897');
    expect(resolved.baseUrl).toBe('https://proxy-inherit.example/v1');
  });
});
