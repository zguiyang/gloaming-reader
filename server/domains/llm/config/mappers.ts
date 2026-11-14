import type { LlmModel, LlmProvider } from '@/shared/llm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@/server/db';
import { parseApiFamily } from '@/server/domains/llm/config/api-family';
import { decryptApiKey, maskApiKey } from '@/server/infra/llm';

type ProviderRow = typeof llmProviderTable.$inferSelect;
type ModelRow = typeof llmModelTable.$inferSelect;

/** Shape a provider row for both the instance and the user-scoped APIs. */
export function toProviderView(row: ProviderRow): LlmProvider {
  const apiFamily = parseApiFamily(row.apiFamily);
  let apiKeyMasked: string | null = null;
  try {
    apiKeyMasked = maskApiKey(decryptApiKey(row.apiKeyCiphertext));
  } catch {
    apiKeyMasked = '****';
  }
  return {
    id: row.id,
    apiFamily,
    name: row.name,
    baseUrl: row.baseUrl,
    proxyUrl: row.proxyUrl ?? null,
    thinkingParam: row.thinkingParam ?? null,
    balanceEndpoint: row.balanceEndpoint ?? null,
    balanceAmountPath: row.balanceAmountPath ?? null,
    balanceCurrencyPath: row.balanceCurrencyPath ?? null,
    isEnabled: row.isEnabled,
    apiKeySet: true,
    apiKeyMasked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Shape a model row for both the instance and the user-scoped APIs. */
export function toModelView(row: ModelRow): LlmModel {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    label: row.label,
    wireVariant: row.wireVariant,
    contextLength: row.contextLength,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    isEnabled: row.isEnabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
