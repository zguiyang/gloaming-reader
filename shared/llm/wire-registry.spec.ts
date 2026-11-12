import { describe, expect, it } from 'vitest';

import {
  assertWireVariantForFamily,
  getDefaultWireVariant,
  isLlmApiFamily,
  isRuntimeImplemented,
  isWireVariantForFamily,
  listWireFamilies,
  LLM_API_FAMILIES,
  validateWireRegistry,
} from './wire-registry';

describe('wire-registry', () => {
  it('passes internal consistency validation', () => {
    expect(() => validateWireRegistry()).not.toThrow();
  });

  it('lists all registered families', () => {
    expect(listWireFamilies()).toHaveLength(LLM_API_FAMILIES.length);
  });

  it('validates openai wire variants', () => {
    expect(isWireVariantForFamily('openai', 'chat-completions')).toBe(true);
    expect(isWireVariantForFamily('openai', 'responses')).toBe(true);
    expect(isWireVariantForFamily('openai', 'messages')).toBe(false);
    expect(getDefaultWireVariant('openai')).toBe('chat-completions');
  });

  it('rejects cross-family wire variants', () => {
    expect(() => assertWireVariantForFamily('anthropic', 'responses')).toThrow();
    expect(isWireVariantForFamily('anthropic', 'messages')).toBe(true);
  });

  it('tracks runtime implementation flags', () => {
    expect(isRuntimeImplemented('openai')).toBe(true);
    expect(isRuntimeImplemented('anthropic')).toBe(false);
    expect(isRuntimeImplemented('gemini')).toBe(false);
  });

  it('narrows api family strings', () => {
    expect(isLlmApiFamily('openai')).toBe(true);
    expect(isLlmApiFamily('cohere')).toBe(false);
  });
});
