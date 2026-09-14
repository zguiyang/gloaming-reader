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

  it('loads admin taxonomy panel keys in zh-CN and en-US', () => {
    const keys = [
      'admin.taxonomy.panel.tableIndex',
      'admin.taxonomy.panel.tableChinese',
      'admin.taxonomy.panel.tableEnglish',
      'admin.taxonomy.panel.tableTranslationStatus',
      'admin.taxonomy.panel.tableUpdatedAt',
      'admin.taxonomy.panel.missingChinese',
      'admin.taxonomy.panel.missingEnglish',
      'admin.taxonomy.panel.translationComplete',
      'admin.taxonomy.panel.translationPartial',
      'admin.taxonomy.panel.translationFilterAll',
      'admin.taxonomy.panel.translationFilterComplete',
      'admin.taxonomy.panel.translationFilterPartial',
      'admin.taxonomy.sheet.nameZhLabel',
      'admin.taxonomy.sheet.nameEnLabel',
    ] as const;

    for (const key of keys) {
      expect(t('zh-CN', key)).not.toBe(key);
      expect(t('en-US', key)).not.toBe(key);
    }

    expect(t('zh-CN', 'admin.taxonomy.panel.missingChinese')).toBe('缺失中文');
    expect(t('en-US', 'admin.taxonomy.panel.missingChinese')).toBe('Missing Chinese');
  });
});
