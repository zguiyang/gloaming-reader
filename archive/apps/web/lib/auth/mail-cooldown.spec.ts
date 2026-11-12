import { describe, expect, it } from 'vitest';

import { resolveMailCooldownErrorMessage } from './mail-cooldown';

describe('resolveMailCooldownErrorMessage', () => {
  it('maps Better Auth rate-limit 429 to localized copy', () => {
    expect(resolveMailCooldownErrorMessage({ status: 429, message: 'Too many requests' }, 'en-US')).toBe(
      'Too many requests. Please try again later.',
    );
    expect(resolveMailCooldownErrorMessage({ status: 429 }, 'zh-CN')).toBe('请求过于频繁，请稍后再试');
  });

  it('returns null for unrelated errors', () => {
    expect(resolveMailCooldownErrorMessage({ code: 'OTHER', message: 'nope' })).toBeNull();
  });
});
