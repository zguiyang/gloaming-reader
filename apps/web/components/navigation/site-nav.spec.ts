// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useNavAccount: vi.fn(),
  openLogin: vi.fn(),
}));

vi.mock('@/components/brand-mark', () => ({ ['BrandMark']: () => null }));
vi.mock('@/components/navigation/account-menu', () => ({
  ['AccountMenu']: () => null,
  useNavAccount: mocks.useNavAccount,
}));
vi.mock('@/components/navigation/desktop-nav', () => ({ ['DesktopNav']: () => null }));
vi.mock('@/components/navigation/theme-mode-control', () => ({ ['ThemeModeNavButton']: () => null }));
vi.mock('@/components/ui/skeleton', () => ({ ['Skeleton']: () => null }));
vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('@/features/library', async () => {
  const React = await import('react');
  return {
    ['LibraryUploadDialog']: ({ open }: { open: boolean }) =>
      React.createElement('div', { 'data-testid': 'upload-dialog', 'data-open': open }),
  };
});

import { LocaleProvider } from '@/lib/locale-context';

import { SiteNav } from './site-nav';

function withLocale(children: ReactNode) {
  // eslint-disable-next-line react/no-children-prop -- test-only LocaleProvider wrapper
  return createElement(LocaleProvider, { locale: 'zh-CN', children });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.useNavAccount.mockReturnValue({
    user: { id: 'user-1' },
    isPending: false,
    username: 'reader',
    email: 'reader@example.test',
    initial: 'R',
    image: null,
    isAdmin: false,
    signOut: vi.fn(),
  });
});

describe('SiteNav upload action', () => {
  it('shows the app upload action and opens the shared dialog', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(withLocale(createElement(SiteNav, { showUpload: true }))));

    expect(container.querySelector('button[aria-label="上传 EPUB"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="upload-dialog"]')?.getAttribute('data-open')).toBe('false');
    await act(async () => (container.querySelector('button[aria-label="上传 EPUB"]') as HTMLButtonElement)?.click());
    expect(container.querySelector('[data-testid="upload-dialog"]')?.getAttribute('data-open')).toBe('true');

    await act(async () => root.unmount());
    container.remove();
  });

  it('omits the app-only upload action from landing navigation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(withLocale(createElement(SiteNav))));

    expect(container.querySelector('button[aria-label="上传 EPUB"]')).toBeNull();
    expect(container.querySelector('[data-testid="upload-dialog"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
