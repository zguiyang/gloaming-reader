import { describe, expect, it } from 'vitest';

import {
  computePublicClassificationFingerprint,
  type PublicClassificationEvidence,
  resolvePublicClassificationRetryAt,
} from '@/domains/discovery/categories';

function evidence(overrides: Partial<PublicClassificationEvidence> = {}): PublicClassificationEvidence {
  return {
    title: 'A Bounded Book',
    authors: ['Author One', 'Author Two'],
    languages: ['en-US'],
    description: 'A bounded description.',
    subjects: ['Space'],
    bookshelves: ['Science'],
    ...overrides,
  };
}

describe('public classification evidence fingerprint', () => {
  it('is stable for identical evidence and ignores nothing else', () => {
    expect(computePublicClassificationFingerprint(evidence())).toBe(computePublicClassificationFingerprint(evidence()));
  });

  it('changes for each substantive classification evidence field', () => {
    const base = computePublicClassificationFingerprint(evidence());
    const variants: Array<Partial<PublicClassificationEvidence>> = [
      { title: 'A Different Book' },
      { authors: ['Someone Else'] },
      { languages: ['fr-FR'] },
      { description: 'Rewritten description.' },
      { subjects: ['Space', 'Exploration'] },
      { bookshelves: ['History'] },
    ];
    for (const variant of variants) {
      expect(computePublicClassificationFingerprint(evidence(variant))).not.toBe(base);
    }
  });
});

describe('public classification retry policy', () => {
  const now = new Date('2030-01-01T12:00:00.000Z');

  it('uses a bounded short delay for busy, provider, and transient deferrals', () => {
    expect(resolvePublicClassificationRetryAt({ status: 'deferred', reason: 'busy' }, now).getTime()).toBe(
      now.getTime() + 2 * 60_000,
    );
    expect(
      resolvePublicClassificationRetryAt({ status: 'deferred', reason: 'provider_unavailable' }, now).getTime(),
    ).toBe(now.getTime() + 15 * 60_000);
    expect(resolvePublicClassificationRetryAt({ status: 'deferred', reason: 'transient_failure' }, now).getTime()).toBe(
      now.getTime() + 15 * 60_000,
    );
  });

  it('delays skipped ineligible and limit outcomes without a rapid loop', () => {
    expect(
      resolvePublicClassificationRetryAt({ status: 'skipped', reason: 'source_record_not_eligible' }, now).getTime(),
    ).toBe(now.getTime() + 6 * 60 * 60_000);
    expect(
      resolvePublicClassificationRetryAt({ status: 'skipped', reason: 'candidate_limit_exceeded' }, now).getTime(),
    ).toBe(now.getTime() + 24 * 60 * 60_000);
    expect(
      resolvePublicClassificationRetryAt({ status: 'skipped', reason: 'input_limit_exceeded' }, now).getTime(),
    ).toBe(now.getTime() + 24 * 60 * 60_000);
  });
});
