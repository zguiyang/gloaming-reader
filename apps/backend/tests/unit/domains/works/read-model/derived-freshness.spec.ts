import { describe, expect, it, vi } from 'vitest';

import { hashPartAudioContent } from '@/domains/works/content';
import { getWorkDerivedFreshness } from '@/domains/works/read-model/derived-freshness';

vi.mock('@/infra/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '@/infra/db';

const PART_ID = 'part_1';
const WORK_ID = 'work_1';
const BODY = '<p>Listen body here.</p>';

function mockAudioRows(rows: Array<{ partId: string; status: string; contentHash: string }>) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
}

describe('getWorkDerivedFreshness audio hash', () => {
  it('stays fresh when only the title changes', async () => {
    const contentHash = hashPartAudioContent(BODY);
    mockAudioRows([{ partId: PART_ID, status: 'ready', contentHash }]);

    const result = await getWorkDerivedFreshness({
      id: WORK_ID,
      partId: PART_ID,
      title: 'Renamed chapter',
      body: BODY,
    });

    expect(result.audio).toBe('fresh');
  });

  it('is stale when body changes relative to ready audio hash', async () => {
    const contentHash = hashPartAudioContent(BODY);
    mockAudioRows([{ partId: PART_ID, status: 'ready', contentHash }]);

    const result = await getWorkDerivedFreshness({
      id: WORK_ID,
      partId: PART_ID,
      title: 'Chapter',
      body: '<p>Updated listen body.</p>',
    });

    expect(result.audio).toBe('stale');
  });
});
