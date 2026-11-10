import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { readingWork as readingWorkTable } from '@gloaming/db';

import { enrichWorkMetadata } from '@/domains/metadata';
import { db } from '@/infra/db';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';

const { invokeAiMock } = vi.hoisted(() => ({ invokeAiMock: vi.fn() }));

vi.mock('@/domains/ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, invokeAi: invokeAiMock };
});

describe('Catalog metadata enrichment', () => {
  const workIds: string[] = [];

  afterAll(async () => {
    for (const workId of workIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
  });

  it('fills only a weak description and advances the existing metadata step', async () => {
    invokeAiMock.mockResolvedValue({
      content: {
        description: 'A factual, spoiler-free description of a story about choices and the people they affect.',
      },
    });
    const fixture = await createCatalogWorkFixture({
      title: `Enrichment ${Date.now()}`,
      processingStatus: 'metadata',
      body: '<p>A story begins with a journey and follows the characters through several changes.</p>',
    });
    workIds.push(fixture.id);

    const result = await enrichWorkMetadata(fixture.id);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, fixture.id));
    expect(result.ok).toBe(true);
    expect(work!.processingStatus).toBe('ready');
    expect(work!.description).toContain('spoiler-free description');
    expect(work!.descriptionProvenance).toBe('ai');
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
  });
});
