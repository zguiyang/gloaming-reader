import { describe, expect, it } from 'vitest';

import { REDACTED, sanitizeLogString, sanitizeLogUrl, serializeLogError } from '@/server/infra/logging/log-redaction';

describe('sanitizeLogUrl', () => {
  it('redacts userinfo in connection URLs', () => {
    const sanitized = sanitizeLogUrl('redis://default:super-secret@127.0.0.1:6379');
    expect(sanitized).not.toContain('super-secret');
    expect(decodeURIComponent(sanitized)).toContain(REDACTED);
    expect(sanitized).toContain('127.0.0.1:6379');
  });

  it('redacts sensitive query parameters', () => {
    const sanitized = sanitizeLogUrl('https://app.example/verify-email?token=abc123&next=%2F');
    expect(decodeURIComponent(sanitized)).toContain(`token=${REDACTED}`);
    expect(sanitized).not.toContain('abc123');
  });
});

describe('sanitizeLogString', () => {
  it('redacts Bearer tokens embedded in text', () => {
    const sanitized = sanitizeLogString('Upstream rejected Authorization: Bearer sk-live-abcdef');
    expect(sanitized).not.toContain('sk-live-abcdef');
    expect(sanitized).toContain(`Bearer ${REDACTED}`);
  });

  it('redacts credentials embedded in a larger message', () => {
    const sanitized = sanitizeLogString('connect failed for redis://user:my-pass@cache.internal:6379');
    expect(sanitized).not.toContain('my-pass');
    expect(sanitized).toContain(REDACTED);
  });
});

describe('serializeLogError', () => {
  it('redacts Redis AUTH command arguments (ioredis ReplyError shape)', () => {
    const err = new Error('WRONGPASS invalid username-password pair or user is disabled.') as Error & {
      command: { name: string; args: string[] };
    };
    err.name = 'ReplyError';
    err.command = { name: 'auth', args: ['default', 'plain-text-password'] };

    const serialized = serializeLogError(err) as {
      command?: { args?: string[] };
      message?: string;
    };

    expect(serialized.message).toContain('WRONGPASS');
    expect(serialized.command?.args?.[0]).toBe('default');
    expect(serialized.command?.args?.[1]).toBe(REDACTED);
    expect(JSON.stringify(serialized)).not.toContain('plain-text-password');
  });

  it('redacts connection strings on generic error fields', () => {
    const err = new Error('connection failed') as Error & { connectionString: string };
    err.connectionString = 'postgresql://admin:secret@db.internal:5432/app';
    const serialized = serializeLogError(err) as { connectionString?: string };
    expect(serialized.connectionString).toBe(REDACTED);
  });
});
