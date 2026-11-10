// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { LlmModel, LlmProvider } from '@gloaming/shared/llm';

import { AiModelForm } from '@/features/admin/ai/ai-model-form';
import { LocaleProvider } from '@/lib/locale-context';

describe('AiModelForm validation', () => {
  it('shows and associates both parameter errors without submitting', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSubmit = vi.fn();
    const provider = { id: 'provider', apiFamily: 'openai' } as LlmProvider;
    const model = {
      modelId: 'model',
      label: 'Model',
      wireVariant: 'chat-completions',
      temperature: 3,
      maxTokens: 0,
      contextLength: null,
      isEnabled: true,
      sortOrder: 0,
    } as LlmModel;
    await act(async () =>
      root.render(
        // LocaleProvider's props type requires children here.
        // eslint-disable-next-line react/no-children-prop
        createElement(LocaleProvider, {
          locale: 'zh-CN',
          children: createElement(AiModelForm, { formId: 'test-model', provider, model, onSubmit, onCancel: vi.fn() }),
        }),
      ),
    );
    await act(async () =>
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    for (const name of ['temperature', 'max-tokens']) {
      const input = container.querySelector(`#test-model-${name}`);
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      const errorId = input?.getAttribute('aria-describedby');
      expect(errorId).toBeTruthy();
      expect(container.querySelector(`#${errorId}`)?.textContent).toBeTruthy();
    }
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });
});
