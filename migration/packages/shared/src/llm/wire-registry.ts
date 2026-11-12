/**
 * LLM wire protocol registry — SSOT for API families, wire variants, and admin capabilities.
 * Used by shared validation, backend runtime, and Admin UI. Not a runtime adapter.
 */

export const LLM_API_FAMILIES = ['openai', 'anthropic', 'gemini'] as const;

export type LlmApiFamily = (typeof LLM_API_FAMILIES)[number];

export type LlmProviderOptionalField = 'thinkingParam';

export type LlmWireVariantDefinition = {
  id: string;
  label: string;
  endpoint: string;
  description: string;
};

export type LlmApiFamilyDefinition = {
  id: LlmApiFamily;
  label: string;
  description: string;
  runtimeImplemented: boolean;
  provider: {
    baseUrlPlaceholder: string;
    baseUrlHint: string;
    optionalFields: readonly LlmProviderOptionalField[];
    capabilities: {
      modelList: boolean;
      balanceQuery: boolean;
    };
  };
  wireVariants: readonly LlmWireVariantDefinition[];
  defaultWireVariant: string;
};

export const LLM_WIRE_REGISTRY: Record<LlmApiFamily, LlmApiFamilyDefinition> = {
  openai: {
    id: 'openai',
    label: 'OpenAI 兼容',
    description: 'Chat Completions 与 Responses API；当前运行时已接入。',
    runtimeImplemented: true,
    provider: {
      baseUrlPlaceholder: 'https://api.example.com/v1',
      baseUrlHint: '需包含协议，通常以 /v1 结尾。',
      optionalFields: ['thinkingParam'],
      capabilities: { modelList: true, balanceQuery: true },
    },
    wireVariants: [
      {
        id: 'chat-completions',
        label: 'Chat Completions',
        endpoint: '/v1/chat/completions',
        description: '默认线路，兼容性最好。',
      },
      {
        id: 'responses',
        label: 'Responses API',
        endpoint: '/v1/responses',
        description: 'OpenAI 新响应协议；网关同时提供双端点时可选用。',
      },
    ],
    defaultWireVariant: 'chat-completions',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Messages API；已注册，运行时尚未接入。',
    runtimeImplemented: false,
    provider: {
      baseUrlPlaceholder: 'https://api.anthropic.com',
      baseUrlHint: 'Anthropic API 根地址（以实现为准）。',
      optionalFields: [],
      capabilities: { modelList: false, balanceQuery: false },
    },
    wireVariants: [
      {
        id: 'messages',
        label: 'Messages API',
        endpoint: '/v1/messages',
        description: 'Anthropic Messages 线路。',
      },
    ],
    defaultWireVariant: 'messages',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Generate Content API；已注册，运行时尚未接入。',
    runtimeImplemented: false,
    provider: {
      baseUrlPlaceholder: 'https://generativelanguage.googleapis.com',
      baseUrlHint: 'Google AI Gemini API 根地址（以实现为准）。',
      optionalFields: [],
      capabilities: { modelList: false, balanceQuery: false },
    },
    wireVariants: [
      {
        id: 'generate-content',
        label: 'Generate Content',
        endpoint: '/v1beta/models/{model}:generateContent',
        description: 'Gemini 内容生成线路。',
      },
    ],
    defaultWireVariant: 'generate-content',
  },
};

export function isLlmApiFamily(value: string): value is LlmApiFamily {
  return (LLM_API_FAMILIES as readonly string[]).includes(value);
}

export function getWireFamilyDefinition(family: LlmApiFamily): LlmApiFamilyDefinition {
  return LLM_WIRE_REGISTRY[family];
}

export function listWireFamilies(): LlmApiFamilyDefinition[] {
  return LLM_API_FAMILIES.map((id) => LLM_WIRE_REGISTRY[id]);
}

export function isWireVariantForFamily(family: LlmApiFamily, wireVariant: string): boolean {
  return LLM_WIRE_REGISTRY[family].wireVariants.some((variant) => variant.id === wireVariant);
}

export function assertWireVariantForFamily(family: LlmApiFamily, wireVariant: string): void {
  if (!isWireVariantForFamily(family, wireVariant)) {
    throw new Error(`Wire variant "${wireVariant}" is not valid for API family "${family}"`);
  }
}

export function getDefaultWireVariant(family: LlmApiFamily): string {
  return LLM_WIRE_REGISTRY[family].defaultWireVariant;
}

export function isRuntimeImplemented(family: LlmApiFamily): boolean {
  return LLM_WIRE_REGISTRY[family].runtimeImplemented;
}

export function getWireVariantLabel(family: LlmApiFamily, wireVariant: string): string {
  const match = LLM_WIRE_REGISTRY[family].wireVariants.find((variant) => variant.id === wireVariant);
  return match?.label ?? wireVariant;
}

export function providerSupportsOptionalField(family: LlmApiFamily, field: LlmProviderOptionalField): boolean {
  return LLM_WIRE_REGISTRY[family].provider.optionalFields.includes(field);
}

/** Validate registry internal consistency (tests). */
export function validateWireRegistry(): void {
  for (const family of LLM_API_FAMILIES) {
    const def = LLM_WIRE_REGISTRY[family];
    if (def.id !== family) {
      throw new Error(`Registry id mismatch for ${family}`);
    }
    if (!isWireVariantForFamily(family, def.defaultWireVariant)) {
      throw new Error(`defaultWireVariant invalid for ${family}`);
    }
    if (def.wireVariants.length === 0) {
      throw new Error(`wireVariants empty for ${family}`);
    }
  }
}

validateWireRegistry();
