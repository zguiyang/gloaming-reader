// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api-request', () => ({ apiRequest: mocks.apiRequest, formatApiError: () => 'Request failed' }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { LocaleProvider } from '@/lib/locale-context';

import { SourceCategoryMappings } from './source-category-mappings';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('source category administration', () => {
  it.each([
    ['zh-CN', '建议无效或与已有分类冲突，请人工检查并决定如何处理。'],
    ['en-US', 'The suggestion is invalid or conflicts with an existing category. Review it and decide how to proceed.'],
  ] as const)(
    'localizes the stored system fallback in %s without replacing AI explanations',
    async (locale, expected) => {
      mocks.apiRequest.mockReset();
      const base = {
        sourceKey: 'gutenberg',
        status: 'review',
        revision: 2,
        categoryIds: [],
        lastError: null,
        leaseUntil: null,
        canAnalyze: false,
        reconciliation: null,
      };
      const proposal = { outcome: 'review', categoryIds: [], newName: null, meaning: null };
      mocks.apiRequest.mockResolvedValue({
        items: [
          {
            ...base,
            id: 'system',
            sourceValue: 'Category: System',
            suggestion: { ...proposal, rationale: 'Invalid or conflicting AI proposal requires review.' },
          },
          {
            ...base,
            id: 'model',
            sourceValue: 'Category: Model',
            suggestion: { ...proposal, rationale: 'A model explanation.' },
          },
        ],
        hasMore: false,
      });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      try {
        await act(async () =>
          root.render(
            createElement(
              QueryClientProvider,
              { client },
              // eslint-disable-next-line react/no-children-prop
              createElement(LocaleProvider, {
                locale,
                children: createElement(SourceCategoryMappings, { categories: [] }),
              }),
            ),
          ),
        );
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
        expect(container.textContent).toContain(expected);
        expect(container.textContent).toContain('A model explanation.');
      } finally {
        await act(async () => root.unmount());
        client.clear();
        container.remove();
      }
    },
  );
  it('continues bounded updates until completion only after an explicit click', async () => {
    mocks.apiRequest.mockReset();
    let batches = 0;
    mocks.apiRequest.mockImplementation((_: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return Promise.resolve({ status: ++batches === 1 ? 'pending' : 'completed' });
      return Promise.resolve({
        items: [
          {
            id: 'mapping-1',
            sourceKey: 'gutenberg',
            sourceValue: 'Category: Fiction',
            status: 'confirmed',
            revision: 1,
            suggestion: null,
            categoryIds: [],
            lastError: null,
            leaseUntil: null,
            canAnalyze: false,
            reconciliation: 'pending',
          },
        ],
        hasMore: false,
      });
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    try {
      await act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            // eslint-disable-next-line react/no-children-prop
            createElement(LocaleProvider, {
              locale: 'zh-CN',
              children: createElement(SourceCategoryMappings, { categories: [] }),
            }),
          ),
        ),
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(batches).toBe(0);
      const button = Array.from(container.querySelectorAll('button')).find((item) =>
        item.textContent?.includes('更新已有作品关联'),
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(batches).toBe(2);
    } finally {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
    }
  });
  it('only requests AI analysis after an explicit click', async () => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockImplementation((_: string, options?: { method?: string }) =>
      Promise.resolve(
        options?.method === 'POST'
          ? { status: 'review' }
          : {
              items: [
                {
                  id: 'mapping-1',
                  sourceKey: 'gutenberg',
                  sourceValue: 'Category: Fiction',
                  status: 'pending',
                  revision: 0,
                  suggestion: null,
                  categoryIds: [],
                  lastError: null,
                  leaseUntil: null,
                  canAnalyze: true,
                  reconciliation: null,
                },
              ],
              hasMore: false,
            },
      ),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            // eslint-disable-next-line react/no-children-prop
            createElement(LocaleProvider, {
              locale: 'zh-CN',
              children: createElement(SourceCategoryMappings, { categories: [] }),
            }),
          ),
        );
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(mocks.apiRequest.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0);
      const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes('AI'));
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        '/api/admin/discovery/source-category-mappings/mapping-1/analyze',
        expect.objectContaining({ method: 'POST', json: { enableThinking: true } }),
      );
    } finally {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
    }
  });
});
