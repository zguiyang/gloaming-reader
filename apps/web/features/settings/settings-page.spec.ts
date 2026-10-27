// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmAppSettingView } from '@gloaming/shared/llm';

import type * as SettingsApi from '@/features/settings/settings-api';
import { LocaleProvider } from '@/lib/locale-context';

import { SettingsPage } from './settings-page';

const mocks = vi.hoisted(() => ({
  openLogin: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  listUserLlmProviders: vi.fn(),
  listUserLlmSettings: vi.fn(),
  getUserTtsConfig: vi.fn(),
  getPersonalTaggingPreference: vi.fn(),
  listUserLlmModels: vi.fn(),
  putUserLlmSetting: vi.fn(),
  createUserLlmModel: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false, error: null }) },
}));
vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo },
}));
vi.mock('@/features/settings/settings-api', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsApi>();
  return {
    ...actual,
    listUserLlmProviders: (...args: unknown[]) => mocks.listUserLlmProviders(...args),
    listUserLlmSettings: (...args: unknown[]) => mocks.listUserLlmSettings(...args),
    getUserTtsConfig: (...args: unknown[]) => mocks.getUserTtsConfig(...args),
    getPersonalTaggingPreference: (...args: unknown[]) => mocks.getPersonalTaggingPreference(...args),
    listUserLlmModels: (...args: unknown[]) => mocks.listUserLlmModels(...args),
    putUserLlmSetting: (...args: unknown[]) => mocks.putUserLlmSetting(...args),
    createUserLlmModel: (...args: unknown[]) => mocks.createUserLlmModel(...args),
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listUserLlmProviders.mockResolvedValue([]);
  mocks.listUserLlmSettings.mockResolvedValue([]);
  mocks.getUserTtsConfig.mockResolvedValue(null);
  mocks.listUserLlmModels.mockResolvedValue([]);
  mocks.putUserLlmSetting.mockReset();
  mocks.createUserLlmModel.mockReset();
  mocks.createUserLlmModel.mockImplementation(async (body: unknown) => body);
  mocks.putUserLlmSetting.mockImplementation(async () => ({
    key: 'assist.default_model_id',
    modelId: 'model-a',
    modelLabel: 'Model A',
    healthy: true,
    runtimeReady: true,
  }));
});

const renderedRoots: Array<() => void> = [];

afterEach(() => {
  while (renderedRoots.length) renderedRoots.pop()?.();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function withProviders(node: ReactElement, client: QueryClient) {
  return createElement(
    QueryClientProvider,
    { client },
    // eslint-disable-next-line react/no-children-prop
    createElement(LocaleProvider, { locale: 'zh-CN', children: node }),
  );
}

async function renderSettings(preference: unknown) {
  mocks.getPersonalTaggingPreference.mockResolvedValue(preference);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(withProviders(createElement(SettingsPage), client)));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    void act(() => root.unmount());
    container.remove();
  };
  renderedRoots.push(cleanup);
  return { container, cleanup };
}

const basePreference = {
  enabled: true,
  generation: 1,
  providerAvailable: true,
  latestRunState: 'failed' as const,
  latestRunErrorCode: null,
};

const PROVIDER = {
  id: 'provider-1',
  apiFamily: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.example.com/v1',
  proxyUrl: null,
  thinkingParam: null,
  balanceEndpoint: null,
  balanceAmountPath: null,
  balanceCurrencyPath: null,
  isEnabled: true,
  apiKeySet: true,
  apiKeyMasked: 'sk-***',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const MODEL_A = {
  id: 'model-a',
  providerId: 'provider-1',
  modelId: 'gpt-a',
  label: 'Model A',
  wireVariant: 'chat-completions',
  contextLength: null,
  temperature: null,
  maxTokens: null,
  isEnabled: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const MODEL_B = { ...MODEL_A, id: 'model-b', modelId: 'gpt-b', label: 'Model B' };

/** Enter the focused own-AI view and return the rendered container. */
async function renderOwnAiView() {
  const view = await renderSettings(basePreference);
  const enter = Array.from(view.container.querySelectorAll('button')).find(
    (button) => button.textContent === '配置自有 AI 服务',
  ) as HTMLButtonElement | undefined;
  expect(enter).toBeTruthy();
  await act(async () => {
    enter?.click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return view;
}

function purposeSelect(view: { container: HTMLElement }, key: string): HTMLSelectElement {
  const select = view.container.querySelector(`select[id="purpose-${key}"]`) as HTMLSelectElement | null;
  expect(select).toBeTruthy();
  return select as HTMLSelectElement;
}

function buttons(view: { container: HTMLElement }, label: string): HTMLButtonElement[] {
  return Array.from(view.container.querySelectorAll('button')).filter(
    // Prefix match so a pending label such as “保存中…” still matches its action.
    (button) => (button.textContent ?? '').trim().startsWith(label),
  ) as HTMLButtonElement[];
}

function changeSelect(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// Native React input setter (matches the pattern in discover/library specs): the prototype
// setter bypasses React's value tracking so the dispatched `input` event registers the change.
function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SettingsPage personal tagging run feedback', () => {
  it('explains a failed run with the copy mapped from a known error code', async () => {
    const view = await renderSettings({
      ...basePreference,
      latestRunErrorCode: 'attempts_exhausted',
    });

    expect(view.container.textContent).toContain('标签整理多次尝试后仍未完成。');
    view.cleanup();
  });

  it('falls back to the generic failure copy for an unknown or missing error code', async () => {
    const unknown = await renderSettings({ ...basePreference, latestRunErrorCode: 'brand_new_reason' });
    expect(unknown.container.textContent).toContain('标签整理未能完成，请稍后重试。');
    unknown.cleanup();

    const missing = await renderSettings({ ...basePreference, latestRunErrorCode: null });
    expect(missing.container.textContent).toContain('标签整理未能完成，请稍后重试。');
    missing.cleanup();
  });

  it('keeps the plain run state copy for non-failed runs', async () => {
    const view = await renderSettings({
      ...basePreference,
      latestRunState: 'completed',
      latestRunErrorCode: null,
    });

    expect(view.container.textContent).toContain('上次标签整理已完成');
    expect(view.container.textContent).not.toContain('标签整理未能完成');
    view.cleanup();
  });
});

describe('SettingsPage AI purpose bindings', () => {
  it('keeps clear spacing between the capabilities heading divider and the first selector row', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A]);
    mocks.listUserLlmSettings.mockResolvedValue([]);

    const view = await renderOwnAiView();
    const heading = Array.from(view.container.querySelectorAll('h2')).find((node) => node.textContent === '阅读能力');
    expect(heading).toBeTruthy();
    const divider = heading?.parentElement;
    expect(divider?.className).toContain('border-b');
    // The row list starts with top margin so the divider never touches the first selector
    // (rows stack below the label on narrow and sit beside it on desktop — same gap either way).
    expect(divider?.nextElementSibling?.className).toContain('mt-3');
    view.cleanup();
  });

  it('keeps the purpose selector always visible and hides actions while the draft matches the saved binding', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);
    mocks.listUserLlmSettings.mockResolvedValue([
      { key: 'assist.default_model_id', modelId: 'model-a', modelLabel: 'Model A', healthy: true, runtimeReady: true },
    ] satisfies LlmAppSettingView[]);

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');

    expect(select.value).toBe('model-a');
    expect(select.disabled).toBe(false);
    // No extra edit step: the filled selector expresses the current value directly.
    expect(buttons(view, '保存')).toHaveLength(0);
    expect(buttons(view, '取消')).toHaveLength(0);
    view.cleanup();
  });

  it('reveals Save/Cancel only while the draft differs from the saved binding, and hides them when changed back', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);
    mocks.listUserLlmSettings.mockResolvedValue([
      { key: 'assist.default_model_id', modelId: 'model-a', modelLabel: 'Model A', healthy: true, runtimeReady: true },
    ] satisfies LlmAppSettingView[]);

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');

    changeSelect(select, 'model-b');
    expect(buttons(view, '保存')).toHaveLength(1);
    expect(buttons(view, '取消')).toHaveLength(1);

    changeSelect(select, 'model-a');
    expect(buttons(view, '保存')).toHaveLength(0);
    expect(buttons(view, '取消')).toHaveLength(0);
    view.cleanup();
  });

  it('restores the saved binding on Cancel', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);
    mocks.listUserLlmSettings.mockResolvedValue([
      { key: 'assist.default_model_id', modelId: 'model-a', modelLabel: 'Model A', healthy: true, runtimeReady: true },
    ] satisfies LlmAppSettingView[]);

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');

    changeSelect(select, 'model-b');
    const cancel = buttons(view, '取消')[0];
    expect(cancel).toBeTruthy();
    await act(async () => {
      cancel.click();
    });

    expect(select.value).toBe('model-a');
    expect(buttons(view, '保存')).toHaveLength(0);
    expect(mocks.putUserLlmSetting).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('saves with the exact payload, blocks duplicate submissions while pending, and keeps the saved selection after success', async () => {
    let savedSettings: LlmAppSettingView[] = [
      { key: 'assist.default_model_id', modelId: 'model-a', modelLabel: 'Model A', healthy: true, runtimeReady: true },
    ];
    mocks.listUserLlmSettings.mockImplementation(async () => savedSettings);
    let resolveSave: (value: unknown) => void = () => {};
    mocks.putUserLlmSetting.mockImplementation(
      (key, body) =>
        new Promise((resolve) => {
          // The mocked server now has the new binding, so the post-save refetch returns it.
          savedSettings = [
            { key, modelId: body.modelId, modelLabel: 'Model B', healthy: true, runtimeReady: true },
          ] as LlmAppSettingView[];
          resolveSave = () => resolve(savedSettings[0]);
        }),
    );
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');

    changeSelect(select, 'model-b');
    const save = buttons(view, '保存')[0];
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.putUserLlmSetting).toHaveBeenCalledWith('assist.default_model_id', { modelId: 'model-b' });
    // Pending state blocks duplicate submissions and keeps the draft stable.
    expect(select.disabled).toBe(true);
    const pendingSave = buttons(view, '保存')[0];
    expect(pendingSave.disabled).toBe(true);
    expect(pendingSave.textContent).toBe('保存中…');
    // Cancel is disabled while the request is pending so it cannot imply an abort.
    expect(buttons(view, '取消')[0].disabled).toBe(true);

    await act(async () => {
      resolveSave(savedSettings[0]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Successful save clears the dirty actions, keeps the saved selection, and
    // leaves the selector interactive.
    expect(buttons(view, '保存')).toHaveLength(0);
    expect(buttons(view, '取消')).toHaveLength(0);
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('model-b');
    view.cleanup();
  });

  it('keeps the dirty draft and a retryable save action when the save request fails', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);
    mocks.listUserLlmSettings.mockResolvedValue([
      { key: 'assist.default_model_id', modelId: 'model-a', modelLabel: 'Model A', healthy: true, runtimeReady: true },
    ] satisfies LlmAppSettingView[]);
    mocks.putUserLlmSetting.mockRejectedValue(new Error('network down'));

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');

    changeSelect(select, 'model-b');
    await act(async () => {
      buttons(view, '保存')[0].click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.putUserLlmSetting).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalled();
    // The draft survives the failure and the row stays retryable.
    expect(select.value).toBe('model-b');
    expect(select.disabled).toBe(false);
    const retry = buttons(view, '保存')[0];
    expect(retry.disabled).toBe(false);
    await act(async () => {
      retry.click();
    });
    expect(mocks.putUserLlmSetting).toHaveBeenCalledTimes(2);
    view.cleanup();
  });

  it('keeps the selector usable and the unavailable saved value visible when the bound model is not active', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);
    mocks.listUserLlmSettings.mockResolvedValue([
      {
        key: 'assist.default_model_id',
        modelId: 'model-gone',
        modelLabel: 'Ghost Model',
        healthy: false,
        runtimeReady: false,
      },
    ] satisfies LlmAppSettingView[]);

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');

    // Not disabled merely because the saved selection is unavailable.
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('model-gone');
    const option = Array.from(select.options).find((item) => item.value === 'model-gone');
    // Clearly identified as unavailable and nonselectable as a replacement.
    expect(option?.textContent).toBe('Ghost Model · 不可用');
    expect(option?.disabled).toBe(true);
    expect(view.container.textContent).toContain('当前模型不可用，请重新选择。');
    // Clean state: no actions until the user picks an active alternative.
    expect(buttons(view, '保存')).toHaveLength(0);

    // An active alternative remains selectable, so the binding can be replaced.
    changeSelect(select, 'model-a');
    expect(buttons(view, '保存')).toHaveLength(1);
    expect(select.disabled).toBe(false);
    view.cleanup();
  });

  it('disables the empty placeholder once a purpose is bound but keeps it for unbound purposes', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);
    mocks.listUserLlmSettings.mockResolvedValue([
      { key: 'assist.default_model_id', modelId: 'model-a', modelLabel: 'Model A', healthy: true, runtimeReady: true },
    ] satisfies LlmAppSettingView[]);

    const view = await renderOwnAiView();
    // A bound purpose cannot be cleared (PUT requires a non-empty modelId): empty is not selectable.
    const bound = purposeSelect(view, 'assist.default_model_id');
    expect(Array.from(bound.options).find((option) => option.value === '')?.disabled).toBe(true);
    // An unbound purpose keeps the empty placeholder as its selected “not set” value.
    const unbound = purposeSelect(view, 'translate.default_model_id');
    expect(Array.from(unbound.options).find((option) => option.value === '')?.disabled).toBe(false);
    expect(unbound.value).toBe('');
    view.cleanup();
  });

  it('shows an inline per-row save error and clears it after Cancel', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([PROVIDER]);
    mocks.listUserLlmModels.mockResolvedValue([MODEL_A, MODEL_B]);
    mocks.listUserLlmSettings.mockResolvedValue([
      { key: 'assist.default_model_id', modelId: 'model-a', modelLabel: 'Model A', healthy: true, runtimeReady: true },
    ] satisfies LlmAppSettingView[]);
    mocks.putUserLlmSetting.mockRejectedValue(new Error('network down'));

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');
    changeSelect(select, 'model-b');
    await act(async () => {
      buttons(view, '保存')[0].click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    // Inline failure text on the row, with the draft kept for retry.
    expect(view.container.textContent).toContain('保存失败');
    expect(select.value).toBe('model-b');
    // Cancel restores the saved binding and clears the stale error.
    await act(async () => {
      buttons(view, '取消')[0].click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(view.container.textContent).not.toContain('保存失败');
    expect(select.value).toBe('model-a');
    view.cleanup();
  });
});

describe('SettingsPage provider-grouped model options', () => {
  const P1 = { ...PROVIDER, id: 'provider-1', name: '个人连接' };
  const P2 = { ...PROVIDER, id: 'provider-2', name: '备用连接' };
  // Two providers share the same model label; they must stay distinguishable.
  const M1 = { ...MODEL_A, id: 'm1', providerId: 'provider-1', label: 'gpt-4o-mini', modelId: 'gpt-4o-mini' };
  const M2 = {
    ...MODEL_A,
    id: 'm2',
    providerId: 'provider-2',
    label: 'gpt-4o-mini',
    modelId: 'gpt-4o-mini-2024',
  };

  it('groups purpose options by provider and keeps same-label models distinguishable', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([P1, P2]);
    mocks.listUserLlmModels.mockImplementation(async (providerId: string) =>
      providerId === 'provider-1' ? [M1] : providerId === 'provider-2' ? [M2] : [],
    );
    mocks.listUserLlmSettings.mockResolvedValue([]);

    const view = await renderOwnAiView();
    const select = purposeSelect(view, 'assist.default_model_id');

    // Provider context flows into each option so two "gpt-4o-mini" entries differ.
    const texts = Array.from(select.options).map((option) => option.textContent);
    expect(texts).toContain('gpt-4o-mini · 个人连接');
    expect(texts).toContain('gpt-4o-mini · gpt-4o-mini-2024 · 备用连接');
    // Options are grouped under their provider (optgroup labels).
    const groups = Array.from(select.querySelectorAll('optgroup')).map((group) => group.label);
    expect(groups).toEqual(['个人连接', '备用连接']);
    view.cleanup();
  });

  it('adds a model under the provider whose add action was used', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([P1, P2]);
    mocks.listUserLlmModels.mockImplementation(async (providerId: string) =>
      providerId === 'provider-1' ? [M1] : providerId === 'provider-2' ? [M2] : [],
    );
    mocks.listUserLlmSettings.mockResolvedValue([]);

    const view = await renderOwnAiView();
    // Two per-provider "添加模型" actions; the second belongs to 备用连接 (provider-2).
    const addButtons = buttons(view, '添加模型');
    expect(addButtons).toHaveLength(2);
    await act(async () => {
      addButtons[1].click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const submit = buttons(view, '添加并启用模型')[0];
    expect(submit).toBeTruthy();
    await act(async () => {
      submit.click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    // The created model is owned by provider-2, not the first provider.
    expect(mocks.createUserLlmModel).toHaveBeenCalledTimes(1);
    expect(mocks.createUserLlmModel).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'provider-2' }));
    view.cleanup();
  });

  it('does not reset a newer add draft when an earlier add for another provider completes late', async () => {
    mocks.listUserLlmProviders.mockResolvedValue([P1, P2]);
    mocks.listUserLlmModels.mockImplementation(async (providerId: string) =>
      providerId === 'provider-1' ? [M1] : providerId === 'provider-2' ? [M2] : [],
    );
    mocks.listUserLlmSettings.mockResolvedValue([]);
    let resolveA: (value: unknown) => void = () => {};
    mocks.createUserLlmModel.mockImplementation(
      (body: unknown) =>
        new Promise((resolve) => {
          resolveA = () => resolve(body);
        }),
    );

    const view = await renderOwnAiView();
    const modelIdInput = () => view.container.querySelector<HTMLInputElement>('#settings-model-id');
    const modelLabelInput = () => view.container.querySelector<HTMLInputElement>('#settings-model-label');

    // Open provider-1's add form, fill a valid distinct draft, and submit (stays in flight).
    const addButtons = buttons(view, '添加模型');
    await act(async () => {
      addButtons[0].click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(modelIdInput()).toBeTruthy();
    await act(async () => {
      updateInput(modelIdInput() as HTMLInputElement, 'a-model-id');
      updateInput(modelLabelInput() as HTMLInputElement, 'A Label');
    });
    await act(async () => {
      buttons(view, '添加并启用模型')[0].click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.createUserLlmModel).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'provider-1', modelId: 'a-model-id', label: 'A Label' }),
    );

    // While provider-1's add is pending, open provider-2's add form and type a different draft.
    const addButtonsWhilePending = buttons(view, '添加模型');
    await act(async () => {
      addButtonsWhilePending[1].click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => {
      updateInput(modelIdInput() as HTMLInputElement, 'b-model-id');
      updateInput(modelLabelInput() as HTMLInputElement, 'B Label');
    });
    expect(modelIdInput()?.value).toBe('b-model-id');
    expect(modelLabelInput()?.value).toBe('B Label');

    // provider-1's add completes late; it must not clear provider-2's newer typed draft.
    await act(async () => {
      resolveA({});
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(modelIdInput()).toBeTruthy();
    expect(modelIdInput()?.value).toBe('b-model-id');
    expect(modelLabelInput()?.value).toBe('B Label');
    view.cleanup();
  });
});
