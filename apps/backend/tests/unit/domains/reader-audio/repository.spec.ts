import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildReaderAudioAttemptStorageKey, buildReaderAudioIdentity } from '@/domains/reader-audio/identity';
import { claimSegmentGeneration } from '@/domains/reader-audio/repository';

const mocks = vi.hoisted(() => ({
  values: vi.fn(),
  set: vi.fn(),
  inserted: vi.fn(),
  taken: vi.fn(),
  existing: vi.fn(),
}));
vi.mock('@/infra/db', () => ({
  db: {
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        insert: () => ({ values: mocks.values }),
        select: () => ({ from: () => ({ where: () => ({ limit: mocks.existing }) }) }),
        update: () => ({ set: mocks.set }),
      }),
  },
}));
const identity = buildReaderAudioIdentity({
  partId: 'part',
  role: 'us',
  scopeKey: 'instance',
  ownerUserId: null,
  provider: 'azure',
  region: 'eastus',
  voice: 'voice',
  segmentHash: 'hash',
});
const meta = {
  segmentIndex: 0,
  segmentKey: 'p0:c0',
  paragraphAnchor: '0',
  paragraphTextOffset: 0,
  textLength: 12,
  voice: 'voice',
};

describe('reader audio claim object reference protection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.values.mockReturnValue({ onConflictDoNothing: () => ({ returning: mocks.inserted }) });
    mocks.set.mockReturnValue({ where: () => ({ returning: mocks.taken }) });
  });

  it('references the claim object before synthesis starts on first insertion', async () => {
    mocks.inserted.mockResolvedValue([{ id: 'row' }]);
    const claim = await claimSegmentGeneration(identity, meta);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('Expected claim');
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        generationToken: claim.token,
        storageKey: buildReaderAudioAttemptStorageKey(identity.storageKey, claim.token),
        status: 'generating',
      }),
    );
  });

  it('switches the reference to the new claim object during expired-lease takeover', async () => {
    mocks.inserted.mockResolvedValue([]);
    mocks.existing.mockResolvedValue([{ id: 'row', status: 'generating', leaseExpiresAt: new Date(0) }]);
    mocks.taken.mockResolvedValue([{ id: 'row' }]);
    const claim = await claimSegmentGeneration(identity, meta);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('Expected claim');
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        generationToken: claim.token,
        storageKey: buildReaderAudioAttemptStorageKey(identity.storageKey, claim.token),
        status: 'generating',
      }),
    );
  });

  it('keeps an existing ready object compatible without rewriting its legacy key', async () => {
    mocks.inserted.mockResolvedValue([]);
    const row = { id: 'row', status: 'ready', storageKey: identity.storageKey };
    mocks.existing.mockResolvedValue([row]);
    await expect(claimSegmentGeneration(identity, meta)).resolves.toEqual({ kind: 'ready', row });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
