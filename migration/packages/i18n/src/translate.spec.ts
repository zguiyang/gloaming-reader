import { describe, expect, it } from 'vitest';

import { t } from './translate.ts';

describe('t', () => {
  it('returns localized strings for supported locales', () => {
    expect(t('zh-CN', 'common.loading')).toBe('加载中…');
    expect(t('en-US', 'common.loading')).toBe('Loading…');
  });

  it('interpolates named parameters', () => {
    expect(t('en-US', 'common.greeting', { name: 'Ada' })).toBe('Hello, Ada');
    expect(t('zh-CN', 'common.greeting', { name: '小明' })).toBe('你好，小明');
  });

  it('falls back to the default locale when a key is missing', () => {
    expect(t('en-US', 'meta.fallbackProbe')).toBe('仅中文回退探针');
  });

  it('returns the key when no translation exists', () => {
    expect(t('zh-CN', 'missing.key')).toBe('missing.key');
    expect(t('en-US', 'missing.key')).toBe('missing.key');
  });
});
