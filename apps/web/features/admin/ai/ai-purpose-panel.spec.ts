// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AiSettingKey, LlmAppSettingView, LlmModel, LlmProvider } from '@gloaming/shared/llm';

import { AiPurposePanel } from '@/features/admin/ai/ai-purpose-panel';

vi.mock('@gloaming/i18n', () => ({
  t: (_locale: string, key: string) => key,
}));

vi.mock('@/lib/locale-context', () => ({
  useLocale: () => ({ locale: 'en-US' }),
}));

vi.mock('@/components/ui/combobox', async () => {
  const { createElement } = await import('react');
  const Wrapper = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  const DisabledWrapper = ({ children, disabled }: { children?: ReactNode; disabled?: boolean }) =>
    createElement('div', { 'data-testid': 'combobox', 'data-disabled': disabled ? '' : undefined }, children);
  const ComboboxInput = (props: { id?: string; placeholder?: string; disabled?: boolean }) =>
    createElement('input', {
      id: props.id,
      placeholder: props.placeholder,
      disabled: Boolean(props.disabled),
      readOnly: true,
    });
  return {
    Combobox: DisabledWrapper,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ComboboxCollection: () => null,
    ComboboxContent: Wrapper,
    ComboboxEmpty: Wrapper,
    ComboboxGroup: Wrapper,
    ComboboxInput,
    ComboboxLabel: Wrapper,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ComboboxList: () => null,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ComboboxItem: () => null,
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const PROVIDER = {
  id: 'provider-1',
  apiFamily: 'openai',
  name: 'OpenAI',
  isEnabled: true,
} as unknown as LlmProvider;

const MODEL_A = {
  id: 'model-a',
  providerId: 'provider-1',
  modelId: 'gpt-a',
  label: 'Model A',
  isEnabled: true,
  sortOrder: 0,
} as unknown as LlmModel;

const MODEL_B = { ...MODEL_A, id: 'model-b', modelId: 'gpt-b', label: 'Model B' } as LlmModel;

const SETTINGS = [
  {
    key: 'assist.default_model_id',
    modelId: 'model-a',
    modelLabel: 'Model A',
    healthy: true,
    runtimeReady: true,
  },
] as unknown as LlmAppSettingView[];

type HarnessProps = {
  draftByKey: Partial<Record<AiSettingKey, string>>;
  savingKey?: AiSettingKey | null;
  models?: LlmModel[];
  settings?: LlmAppSettingView[];
  onSave?: (key: AiSettingKey) => void;
};

function Harness({
  draftByKey: initialDraft,
  savingKey = null,
  models = [MODEL_A, MODEL_B],
  settings = SETTINGS,
  onSave,
}: HarnessProps) {
  const [draftByKey, setDraftByKey] = useState<Partial<Record<AiSettingKey, string>>>(initialDraft);
  return createElement(AiPurposePanel, {
    settings,
    providers: [PROVIDER],
    models,
    draftByKey,
    savingKey,
    onDraftChange: (key: AiSettingKey, modelId: string) => setDraftByKey((current) => ({ ...current, [key]: modelId })),
    onSave: onSave ?? (() => {}),
  });
}

const renderedRoots: Array<() => void> = [];

afterEach(() => {
  while (renderedRoots.length) renderedRoots.pop()?.();
});

async function renderPanel(props: HarnessProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness, props)));
  const cleanup = () => {
    void act(() => root.unmount());
    container.remove();
  };
  renderedRoots.push(cleanup);
  return { container, cleanup };
}

function actionButtons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (button) => (button.textContent ?? '').trim() === label,
  ) as HTMLButtonElement[];
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
}

describe('AiPurposePanel purpose rows', () => {
  it('lays the purpose name beside a full-width selector on wide rows and stacks them when narrow', async () => {
    const view = await renderPanel({ draftByKey: {} });

    const row = view.container.querySelector('li');
    // Desktop-wide: the name column and the control column sit side by side…
    expect(row?.className).toContain('sm:flex-row');
    const [nameColumn, controlColumn] = Array.from(row?.children ?? []);
    // …with a fixed-basis left column so long titles wrap without pushing the selector…
    expect(nameColumn?.className).toContain('sm:shrink-0');
    // The title band matches the selector height so a normal name centers vertically
    // against the 44px selector on desktop (long titles grow it without clipping).
    const titleBand = nameColumn?.firstElementChild;
    expect(titleBand?.className).toContain('sm:min-h-[44px]');
    expect(titleBand?.className).toContain('items-center');
    expect(titleBand?.querySelector('p')?.textContent).toBeTruthy();
    // …and the controls keep the stacked order narrow screens use (flex-col is the base layout).
    expect(row?.className).toContain('flex-col');
    expect(controlColumn?.className).toContain('flex-1');
    const [selectorWrapper, actions] = Array.from(controlColumn?.children ?? []);
    // The selector spans the full remaining width: its right edge stays flush with the row
    // content edge (no width cap, no action slot reserving space beside it).
    expect(selectorWrapper?.className).toContain('w-full');
    expect(selectorWrapper?.className).not.toContain('max-w');
    // Reserved constant-footprint action slot below the selector: dirty Save/Cancel appear
    // right-aligned inside it without shifting the selector or neighboring rows.
    expect(actions?.className).toContain('h-9');
    expect(actions?.className).toContain('justify-end');
    expect(actions?.className).not.toContain('sm:w-40');
    view.cleanup();
  });

  it('always shows the selector and hides actions while the draft matches the saved binding', async () => {
    const view = await renderPanel({ draftByKey: {} });

    const input = view.container.querySelector('input[id="purpose-assist.default_model_id"]');
    expect(input).toBeTruthy();
    const combobox = view.container.querySelector('[data-testid="combobox"]');
    expect(combobox?.hasAttribute('data-disabled')).toBe(false);
    expect(actionButtons(view.container, 'admin.content.common.save')).toHaveLength(0);
    expect(actionButtons(view.container, 'admin.content.common.cancel')).toHaveLength(0);
    view.cleanup();
  });

  it('reveals actions only for a dirty row and restores the saved binding on Cancel', async () => {
    const view = await renderPanel({ draftByKey: { 'assist.default_model_id': 'model-b' } });

    const save = actionButtons(view.container, 'admin.content.common.save');
    const cancel = actionButtons(view.container, 'admin.content.common.cancel');
    expect(save).toHaveLength(1);
    expect(save[0].disabled).toBe(false);

    await click(cancel[0]);
    // Cancel restored the saved binding, so the row is clean again and the actions hide.
    expect(actionButtons(view.container, 'admin.content.common.save')).toHaveLength(0);
    expect(actionButtons(view.container, 'admin.content.common.cancel')).toHaveLength(0);
    view.cleanup();
  });

  it('submits the dirty row through onSave', async () => {
    const onSave = vi.fn();
    const view = await renderPanel({ draftByKey: { 'assist.default_model_id': 'model-b' }, onSave });

    const save = actionButtons(view.container, 'admin.content.common.save')[0];
    await click(save);
    expect(onSave).toHaveBeenCalledWith('assist.default_model_id');
    view.cleanup();
  });

  it('gates every purpose row\u2019s save, selector, and cancel while any purpose save is pending', async () => {
    const twoRows = [
      ...SETTINGS,
      {
        key: 'translate.default_model_id',
        modelId: null,
        modelLabel: null,
        healthy: false,
        runtimeReady: true,
      },
    ] as unknown as LlmAppSettingView[];
    const view = await renderPanel({
      draftByKey: { 'assist.default_model_id': 'model-b', 'translate.default_model_id': 'model-b' },
      savingKey: 'assist.default_model_id',
      settings: twoRows,
    });

    // All save buttons are disabled so no duplicate or concurrent submission can start.
    const saves = actionButtons(view.container, 'admin.content.common.save');
    expect(saves).toHaveLength(2);
    expect(saves.every((button) => button.disabled)).toBe(true);
    // All selectors are locked, not only the initiating row.
    const comboboxes = view.container.querySelectorAll('[data-testid="combobox"]');
    expect(comboboxes).toHaveLength(2);
    expect(Array.from(comboboxes).every((node) => node.hasAttribute('data-disabled'))).toBe(true);
    // Cancel is disabled everywhere while a request is pending so it cannot imply an abort.
    const cancels = actionButtons(view.container, 'admin.content.common.cancel');
    expect(cancels).toHaveLength(2);
    expect(cancels.every((button) => button.disabled)).toBe(true);
    view.cleanup();
  });

  it('keeps the selector enabled when the saved binding is unavailable but alternatives exist', async () => {
    const settings = [
      {
        key: 'assist.default_model_id',
        modelId: 'model-gone',
        modelLabel: 'Ghost Model',
        healthy: false,
        runtimeReady: false,
      },
    ] as unknown as LlmAppSettingView[];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(AiPurposePanel, {
          settings,
          providers: [PROVIDER],
          models: [MODEL_A, MODEL_B],
          draftByKey: {},
          savingKey: null,
          onDraftChange: () => {},
          onSave: () => {},
        }),
      ),
    );

    const input = container.querySelector('input[id="purpose-assist.default_model_id"]');
    expect(input).toBeTruthy();
    // Not disabled merely because the saved selection is unavailable.
    const combobox = container.querySelector('[data-testid="combobox"]');
    expect(combobox?.hasAttribute('data-disabled')).toBe(false);
    renderedRoots.push(() => {
      void act(() => root.unmount());
      container.remove();
    });
  });
});
