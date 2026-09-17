import pino from 'pino';

import { commonEnv } from '@/lib/env-common';
import { REDACTED, sanitizeHeaders, sanitizeLogUrl, sanitizeLogValue, serializeLogError } from '@/lib/log-redaction';

const SENSITIVE_LOG_PATHS = [
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'verificationToken',
  'resetToken',
  'apiKey',
  'secret',
  'clientSecret',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.sessionToken',
  '*.verificationToken',
  '*.resetToken',
  '*.apiKey',
  '*.secret',
  '*.clientSecret',
  'headers.cookie',
  'headers.Cookie',
  'headers.authorization',
  'headers.Authorization',
  'headers["proxy-authorization"]',
  'headers["Proxy-Authorization"]',
  'headers["x-api-key"]',
  'headers["X-API-Key"]',
  'headers["api-key"]',
  'headers["Api-Key"]',
  'headers.set-cookie',
  'headers.Set-Cookie',
  '*.headers.cookie',
  '*.headers.Cookie',
  '*.headers.authorization',
  '*.headers.Authorization',
  '*.headers["proxy-authorization"]',
  '*.headers["Proxy-Authorization"]',
  '*.headers["x-api-key"]',
  '*.headers["X-API-Key"]',
  '*.headers["api-key"]',
  '*.headers["Api-Key"]',
  '*.headers.set-cookie',
  '*.headers.Set-Cookie',
];

export const rootLogger = pino({
  level: commonEnv.LOG_LEVEL,
  redact: { paths: SENSITIVE_LOG_PATHS, censor: REDACTED },
  serializers: {
    headers: (value) => sanitizeHeaders(value),
    req: sanitizeLogValue,
    res: sanitizeLogValue,
    request: sanitizeLogValue,
    response: sanitizeLogValue,
    error: sanitizeLogValue,
    body: sanitizeLogValue,
    data: sanitizeLogValue,
    config: sanitizeLogValue,
    url: sanitizeLogUrl,
    uri: sanitizeLogUrl,
    err: serializeLogError,
  },
  transport:
    commonEnv.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,module',
            messageFormat: '{module}: {msg}',
            singleLine: true,
          },
        }
      : undefined,
});

export const dbLogger = rootLogger.child({ module: 'Database' });
export const redisLogger = rootLogger.child({ module: 'Redis' });
export const queueLogger = rootLogger.child({ module: 'Queue' });
export const workerLogger = rootLogger.child({ module: 'Worker' });
export const authLogger = rootLogger.child({ module: 'Auth' });
export const serverLogger = rootLogger.child({ module: 'Server' });
