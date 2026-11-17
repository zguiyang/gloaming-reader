import { describe, expect, it } from 'vitest';

import type { SourceRecordDetail } from '@/shared/discovery';

import { buildDiscoverCatalogChips } from '@/features/discover/discover-model';

function detail(
  partial: Partial<SourceRecordDetail> & Pick<SourceRecordDetail, 'languages' | 'sourceMeta'>,
): SourceRecordDetail {
  return {
    sourceRecordId: 'sr_1',
    linkedWorkId: null,
    sourceId: 'src_1',
    sourceKey: 'project_gutenberg',
    sourceType: 'gutenberg_catalog_index',
    externalId: '11',
    title: 'Alice',
    authors: [{ name: 'Carroll' }],
    description: null,
    coverUrl: null,
    availability: 'available',
    sourceUpdatedAt: null,
    lastSeenAt: null,
    createdAt: null,
    updatedAt: null,
    isSaveable: true,
    detailAvailable: false,
    rightsStatement: null,
    contentCandidates: [],
    ...partial,
  };
}

describe('buildDiscoverCatalogChips', () => {
  it('surfaces language, bookshelves, and subjects without duplicates', () => {
    expect(
      buildDiscoverCatalogChips(
        detail({
          languages: ['en'],
          sourceMeta: {
            bookshelves: ['Children'],
            subjects: ['Fantasy', 'children'],
          },
        }),
      ),
    ).toEqual(['EN', 'Children', 'Fantasy']);
  });

  it('caps long subject lists', () => {
    const subjects = Array.from({ length: 20 }, (_, i) => `Subject ${i}`);
    expect(
      buildDiscoverCatalogChips(
        detail({
          languages: ['en', 'fr'],
          sourceMeta: { subjects },
        }),
      ),
    ).toHaveLength(10);
  });
});
