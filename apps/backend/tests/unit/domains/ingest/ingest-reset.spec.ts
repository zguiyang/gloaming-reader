import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  deleteObject: vi.fn(),
  deleteAudioAssetObjects: vi.fn(),
}));

vi.mock('@/infra/db', () => ({
  db: { transaction: mocks.transaction },
}));
vi.mock('@/infra/storage', () => ({ deleteObject: mocks.deleteObject }));
vi.mock('@/domains/assets/content/audio/object-lifecycle', () => ({
  deleteAudioAssetObjects: mocks.deleteAudioAssetObjects,
}));

import { resetParseStepOutputs } from '@/domains/ingest';

describe('resetParseStepOutputs', () => {
  it('does not delete derived objects when the database reset transaction fails', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('database reset failed'));

    await expect(
      resetParseStepOutputs({ id: 'work-1', descriptionProvenance: null } as Parameters<
        typeof resetParseStepOutputs
      >[0]),
    ).rejects.toThrow('database reset failed');

    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.deleteAudioAssetObjects).not.toHaveBeenCalled();
  });
});
