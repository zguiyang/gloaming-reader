import { describe, expect, it } from 'vitest';

import { resolveMailCooldownErrorMessage } from './mail-cooldown';

describe('resolveMailCooldownErrorMessage', () => {
  it('maps Better Auth rate-limit 429', () => {
    expect(resolveMailCooldownErrorMessage({ status: 429, message: 'Too many requests' })).toContain(
      'Too many requests',
    );
    expect(resolveMailCooldownErrorMessage({ status: 429 })).toMatch(/稍后再试|Please try again later/);
  });

  it('returns null for unrelated errors', () => {
    expect(resolveMailCooldownErrorMessage({ code: 'OTHER', message: 'nope' })).toBeNull();
  });
});
