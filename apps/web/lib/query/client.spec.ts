import { describe, expect, it } from 'vitest';

import { API_INVALID_RESPONSE_CODE, ApiRequestError } from '@/lib/api-request';

import { shouldRetryQuery } from './client';

describe('shouldRetryQuery', () => {
  it('does not retry 4xx client errors', () => {
    const notFound = new ApiRequestError({ message: '未找到', status: 404 });
    expect(shouldRetryQuery(0, notFound)).toBe(false);
    expect(shouldRetryQuery(0, new ApiRequestError({ message: '未登录', status: 401 }))).toBe(false);
    expect(shouldRetryQuery(0, new ApiRequestError({ message: '冲突', status: 409 }))).toBe(false);
  });

  it('does not retry deterministic invalid response contract errors', () => {
    const invalidResponse = new ApiRequestError({
      message: '响应格式无效',
      status: 502,
      code: API_INVALID_RESPONSE_CODE,
    });
    expect(shouldRetryQuery(0, invalidResponse)).toBe(false);
    expect(shouldRetryQuery(2, invalidResponse)).toBe(false);
  });

  it('retries network errors and 5xx up to three times', () => {
    expect(shouldRetryQuery(0, new Error('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(2, new Error('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(3, new Error('Failed to fetch'))).toBe(false);

    const serverError = new ApiRequestError({ message: '服务异常', status: 503 });
    expect(shouldRetryQuery(0, serverError)).toBe(true);
    expect(shouldRetryQuery(3, serverError)).toBe(false);
  });
});
