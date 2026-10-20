// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
