import { z } from 'zod';

import { AI_SETTING_KEY_VALUES } from './llm-config-keys.ts';
import { LLM_API_FAMILIES } from './wire-registry.ts';

export const llmApiFamilySchema = z.enum(LLM_API_FAMILIES);

export type LlmApiFamily = z.infer<typeof llmApiFamilySchema>;

export const llmProviderSchema = z.object({
  id: z.string(),
  apiFamily: llmApiFamilySchema,
  name: z.string(),
  baseUrl: z.string(),
  proxyUrl: z.string().nullable(),
  thinkingParam: z.string().nullable(),
  balanceEndpoint: z.string().nullable(),
  balanceAmountPath: z.string().nullable(),
  balanceCurrencyPath: z.string().nullable(),
  isEnabled: z.boolean(),
  apiKeySet: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type LlmProvider = z.infer<typeof llmProviderSchema>;

export const createLlmProviderBodySchema = z.object({
  apiFamily: llmApiFamilySchema,
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url().max(500),
  apiKey: z.string().min(1).max(2000),
  proxyUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((value) => /^(https?|socks5):\/\//i.test(value), { message: '代理地址需为 http/https/socks5' })
    .optional()
    .nullable(),
  thinkingParam: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, { message: '思考参数名需为合法标识符' })
    .optional()
    .nullable(),
  balanceEndpoint: z
    .string()
    .trim()
    .max(500)
    .refine((value) => /^(https?):\/\//i.test(value) || value.startsWith('/'), {
      message: '余额端点需为 http(s) 地址或以 / 开头的路径',
    })
    .optional()
    .nullable(),
  balanceAmountPath: z.string().trim().min(1).max(200).optional().nullable(),
  balanceCurrencyPath: z.string().trim().min(1).max(50).optional().nullable(),
  isEnabled: z.boolean().optional().default(true),
});

export type CreateLlmProviderBody = z.infer<typeof createLlmProviderBodySchema>;

export const updateLlmProviderBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    baseUrl: z.string().trim().url().max(500).optional(),
    apiKey: z.string().min(1).max(2000).optional(),
    proxyUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .refine((value) => /^(https?|socks5):\/\//i.test(value), { message: '代理地址需为 http/https/socks5' })
      .optional()
      .nullable(),
    thinkingParam: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, { message: '思考参数名需为合法标识符' })
      .optional()
      .nullable(),
    balanceEndpoint: z
      .string()
      .trim()
      .max(500)
      .refine((value) => /^(https?):\/\//i.test(value) || value.startsWith('/'), {
        message: '余额端点需为 http(s) 地址或以 / 开头的路径',
      })
      .optional()
      .nullable(),
    balanceAmountPath: z.string().trim().min(1).max(200).optional().nullable(),
    balanceCurrencyPath: z.string().trim().min(1).max(50).optional().nullable(),
    isEnabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

export type UpdateLlmProviderBody = z.infer<typeof updateLlmProviderBodySchema>;

export const llmModelSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  label: z.string(),
  wireVariant: z.string().min(1),
  contextLength: z.number().int().nullable(),
  temperature: z.number().nullable(),
  maxTokens: z.number().int().nullable(),
  isEnabled: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type LlmModel = z.infer<typeof llmModelSchema>;

export const createLlmModelBodySchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(120),
  wireVariant: z.string().trim().min(1).max(120).optional(),
  contextLength: z.number().int().positive().max(100_000_000).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().positive().max(1_000_000).nullable().optional(),
  isEnabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});

export type CreateLlmModelBody = z.infer<typeof createLlmModelBodySchema>;

export const updateLlmModelBodySchema = z
  .object({
    modelId: z.string().trim().min(1).max(200).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    wireVariant: z.string().trim().min(1).max(120).optional(),
    contextLength: z.number().int().positive().max(100_000_000).nullable().optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
    maxTokens: z.number().int().positive().max(1_000_000).nullable().optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

export type UpdateLlmModelBody = z.infer<typeof updateLlmModelBodySchema>;

export const llmModelListQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
});

export type LlmModelListQuery = z.infer<typeof llmModelListQuerySchema>;

export const llmAppSettingSchema = z.object({
  key: z.enum(AI_SETTING_KEY_VALUES),
  modelId: z.string().nullable(),
  modelLabel: z.string().nullable(),
  healthy: z.boolean(),
  /** False when bound model's API family runtime is not implemented. */
  runtimeReady: z.boolean(),
});

export type LlmAppSettingView = z.infer<typeof llmAppSettingSchema>;

export const putLlmAppSettingBodySchema = z.object({
  modelId: z.string().min(1),
});

export type PutLlmAppSettingBody = z.infer<typeof putLlmAppSettingBodySchema>;

export const testLlmProviderBodySchema = z.object({
  modelId: z.string().min(1).optional(),
});

export type TestLlmProviderBody = z.infer<typeof testLlmProviderBodySchema>;

export const testLlmProviderResultSchema = z.object({
  ok: z.literal(true),
  latencyMs: z.number().int().nonnegative(),
  modelLabel: z.string(),
});

export type TestLlmProviderResult = z.infer<typeof testLlmProviderResultSchema>;

/** A model candidate fetched live from a provider's `GET /models`. */
export const providerModelCandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  ownedBy: z.string().nullable(),
  contextLength: z.number().int().nullable(),
  maxOutputTokens: z.number().int().nullable(),
  pricing: z
    .object({
      prompt: z.string(),
      completion: z.string(),
    })
    .nullable(),
  description: z.string().nullable(),
});

export type ProviderModelCandidate = z.infer<typeof providerModelCandidateSchema>;

export const fetchProviderModelsResultSchema = z.object({
  models: z.array(providerModelCandidateSchema),
});

export type FetchProviderModelsResult = z.infer<typeof fetchProviderModelsResultSchema>;

export const providerBalanceOkSchema = z.object({
  supported: z.literal(true),
  balance: z.number(),
  currency: z.string(),
  used: z.number().nullable(),
  isAvailable: z.boolean().nullable(),
});

export type ProviderBalanceOk = z.infer<typeof providerBalanceOkSchema>;

export const providerBalanceUnsupportedSchema = z.object({
  supported: z.literal(false),
  reason: z.enum(['not-configured', 'invalid-config', 'auth-failed', 'request-failed', 'parse-failed']),
  message: z.string(),
});

export type ProviderBalanceUnsupported = z.infer<typeof providerBalanceUnsupportedSchema>;

export const providerBalanceResultSchema = z.discriminatedUnion('supported', [
  providerBalanceOkSchema,
  providerBalanceUnsupportedSchema,
]);

export type ProviderBalanceResult = z.infer<typeof providerBalanceResultSchema>;
