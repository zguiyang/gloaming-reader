// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useSession: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock('@/components/navigation', () => {
  const siteNav = () => null;
  const mobileBottomNav = () => null;
  return { SiteNav: siteNav, MobileBottomNav: mobileBottomNav };
});

import { AppShell } from './app-shell';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AppShell', () => {
  it('renders public route content while the session request is pending', async () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: true });
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(AppShell, null, createElement('p', null, 'Discover content')));
    });

    expect(container.textContent).toContain('Discover content');
    expect(container.querySelector('[role="status"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('renders public route content after an anonymous session settles', async () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(AppShell, null, createElement('p', null, 'Anonymous route content')));
    });

    expect(container.textContent).toContain('Anonymous route content');
    expect(container.querySelector('[role="status"]')).toBeNull();

    await act(async () => root.unmount());
  });
});
