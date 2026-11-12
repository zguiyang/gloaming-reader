import { describe, expect, it } from 'vitest';

import { getApiFamilyLabel, getWireVariantDisplayLabel } from './ai-locale';

describe('ai-locale', () => {
  it('localizes API family labels per locale', () => {
    expect(getApiFamilyLabel('en-US', 'openai')).toBe('OpenAI compatible');
    expect(getApiFamilyLabel('zh-CN', 'openai')).toBe('OpenAI 兼容');
    expect(getApiFamilyLabel('en-US', 'anthropic')).toBe('Anthropic (Claude)');
  });

  it('localizes wire variant labels per locale', () => {
    expect(getWireVariantDisplayLabel('en-US', 'openai', 'chat-completions')).toBe('Chat Completions');
    expect(getWireVariantDisplayLabel('zh-CN', 'openai', 'responses')).toBe('Responses API');
    expect(getWireVariantDisplayLabel('en-US', 'anthropic', 'messages')).toBe('Messages API');
  });

  it('falls back to shared registry for unknown wire variant ids', () => {
    expect(getWireVariantDisplayLabel('en-US', 'openai', 'unknown-variant')).toBe('unknown-variant');
  });
});
