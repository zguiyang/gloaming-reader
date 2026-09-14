import { describe, expect, it } from 'vitest';

import {
  formatAdminAiPurpose,
  formatAdminAiSource,
  formatAdminDateTime,
  formatAdminInvocationStatus,
  formatAdminTtsRole,
  formatAdminTtsSource,
} from './admin-logs-format';

describe('admin-logs-format', () => {
  it('formats AI source labels per locale while preserving unknown sources', () => {
    expect(formatAdminAiSource('assist.ask', 'zh-CN')).toBe('阅读提问');
    expect(formatAdminAiSource('assist.ask', 'en-US')).toBe('Reading question');
    expect(formatAdminAiSource('custom.source', 'en-US')).toBe('custom.source');
  });

  it('formats AI purpose labels with unbound fallback', () => {
    expect(formatAdminAiPurpose(null, 'zh-CN')).toBe('未绑定');
    expect(formatAdminAiPurpose('assist', 'en-US')).toBe('Reading assistant');
  });

  it('formats TTS source and role labels per locale', () => {
    expect(formatAdminTtsSource('admin.part_audio', 'zh-CN')).toBe('章节音频');
    expect(formatAdminTtsRole('us', 'en-US')).toBe('US English');
    expect(formatAdminTtsRole(null, 'zh-CN')).toBe('默认');
  });

  it('formats invocation status labels per locale', () => {
    expect(formatAdminInvocationStatus('success', 'zh-CN')).toBe('成功');
    expect(formatAdminInvocationStatus('failure', 'en-US')).toBe('Failed');
  });

  it('formats datetimes with locale-aware calendars', () => {
    const iso = '2026-01-15T08:30:00.000Z';
    expect(formatAdminDateTime(iso, 'zh-CN')).toMatch(/2026/);
    expect(formatAdminDateTime(iso, 'en-US')).toMatch(/2026/);
  });
});
