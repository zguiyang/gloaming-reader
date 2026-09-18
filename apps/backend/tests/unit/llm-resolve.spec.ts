import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@gloaming/db';

import { db } from '@/db';
import { AppError } from '@/lib/errors/app-error';
import { encryptApiKey, resolveLlmByModelRowId } from '@/lib/llm';

describe('resolveLlmByModelRowId', () => {
  const providerId = randomUUID();
  const modelId = randomUUID();

  afterAll(async () => {
    await db.delete(llmProviderTable).where(eq(llmProviderTable.id, providerId));
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
});
