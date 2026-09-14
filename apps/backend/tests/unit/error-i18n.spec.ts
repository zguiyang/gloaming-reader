import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/error-codes';
import { AppError, NotFoundError, ValidationFailedError } from '@/lib/errors';
import { resolveRequestLocale } from '@/lib/locale';
import { formatThrownError, sendError, sendValidationError } from '@/lib/response';
import { errorHandler } from '@/middleware/error';

function createTestContext() {
  const app = new Hono();
  let captured: Response | null = null;

  app.get('/probe', (c) => {
    captured = sendError(c, ERROR_CODES.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED) as unknown as Response;
    return captured;
  });

  app.get('/validation', (c) => {
    captured = sendValidationError(c, [
      { path: 'file', message: 'fallback', code: ERROR_CODES.UPLOAD.FILE_REQUIRED },
    ]) as unknown as Response;
    return captured;
  });

  app.get('/locale', (c) => c.json({ locale: resolveRequestLocale(c) }));

  app.get('/format', (c) => c.json(formatThrownError(c, new NotFoundError(ERROR_CODES.NOT_FOUND.WORK))));

  app.get('/throw', () => {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.STATE_CHANGED);
  });
  app.onError(errorHandler);

  const request = (path: string, acceptLanguage?: string) =>
    app.request(path, {
      headers: acceptLanguage ? { 'Accept-Language': acceptLanguage } : undefined,
    });

  return { request };
}

describe('resolveRequestLocale', () => {
  it('defaults to zh-CN when Accept-Language is missing', async () => {
    const { request } = createTestContext();
    const response = await request('/locale');
    await expect(response.json()).resolves.toEqual({ locale: 'zh-CN' });
  });

  it('honors Accept-Language for en-US', async () => {
    const { request } = createTestContext();
    const response = await request('/locale', 'en-US,zh-CN;q=0.8');
    await expect(response.json()).resolves.toEqual({ locale: 'en-US' });
  });
});

describe('localized error responses', () => {
  it('returns error and code with unchanged HTTP status for sendError', async () => {
    const { request } = createTestContext();
    const en = await request('/probe', 'en-US');
    expect(en.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    await expect(en.json()).resolves.toEqual({
      error: 'Unauthorized',
      code: ERROR_CODES.UNAUTHORIZED,
    });

    const zh = await request('/probe', 'zh-CN');
    expect(zh.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    await expect(zh.json()).resolves.toEqual({
      error: '未登录或登录已过期',
      code: ERROR_CODES.UNAUTHORIZED,
    });
  });

  it('localizes validation details while preserving path and adding detail code', async () => {
    const { request } = createTestContext();
    const response = await request('/validation', 'en-US');
    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    await expect(response.json()).resolves.toEqual({
      error: 'Validation failed',
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [
        {
          path: 'file',
          message: 'Please select an EPUB file to upload',
          code: ERROR_CODES.UPLOAD.FILE_REQUIRED,
        },
      ],
    });
  });

  it('routes AppError through the error middleware with stable code', async () => {
    const { request } = createTestContext();
    const response = await request('/throw', 'en-US');
    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    await expect(response.json()).resolves.toEqual({
      error: 'Work state changed; refresh and try again',
      code: ERROR_CODES.WORK.STATE_CHANGED,
    });
  });

  it('formats thrown NotFoundError for SSE-style payloads', async () => {
    const { request } = createTestContext();
    const response = await request('/format', 'zh-CN');
    await expect(response.json()).resolves.toEqual({
      error: '未找到作品',
      code: ERROR_CODES.NOT_FOUND.WORK,
    });
  });
});

describe('ValidationFailedError', () => {
  it('uses the validation failed code on the error instance', () => {
    const error = new ValidationFailedError([{ path: 'name', message: 'required' }]);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});
