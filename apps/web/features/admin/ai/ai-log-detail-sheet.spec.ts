import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@gloaming/i18n', () => ({
  t: (_locale: string, key: string) => key,
}));

vi.mock('@/lib/locale-context', () => ({
  useLocale: () => ({ locale: 'en-US' }),
}));

vi.mock('@/components/ui/sheet', async () => {
  const { createElement } = await import('react');
  const Wrapper = ({ children }: { children: ReactNode }) => createElement('div', null, children);
  const Title = ({ children }: { children: ReactNode }) => createElement('h2', null, children);
  const Description = ({ children }: { children: ReactNode }) => createElement('p', null, children);
  return {
    Sheet: Wrapper,
    SheetContent: Wrapper,
    SheetDescription: Description,
    SheetHeader: Wrapper,
    SheetTitle: Title,
  };
});

vi.mock('@/components/ui/separator', async () => {
  const { createElement } = await import('react');
  return { ['Separator']: () => createElement('hr') };
});

import { AiLogDetailSheet } from '@/features/admin/ai/ai-log-detail-sheet';

describe('AiLogDetailSheet', () => {
  it('renders operational details without invocation content', () => {
    const markup = renderToStaticMarkup(
      createElement(AiLogDetailSheet, {
        log: {
          id: 'log_1',
          createdAt: '2026-09-29T00:00:00.000Z',
          status: 'success',
          errorCode: null,
          errorMessage: null,
          purpose: 'assist',
          source: 'assist.ask',
          userId: null,
          refType: 'reading_work',
          refId: 'work_1',
          modelRowId: 'model_1',
          providerId: 'provider_1',
          modelId: 'gpt-test',
          baseUrl: null,
          latencyMs: 120,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costAmount: null,
          costCurrency: null,
          requestSummary: { messageCount: 2, actionId: 'meaning' },
          responseSummary: { replyLength: 12 },
        },
        sourceLabel: 'Assist',
        purposeLabel: 'Assist',
        onOpenChange: () => undefined,
      }),
    );

    expect(markup).toContain('gpt-test');
    expect(markup).toContain('15');
    expect(markup).not.toContain('private selection');
    expect(markup).not.toContain('private response');
  });
});
