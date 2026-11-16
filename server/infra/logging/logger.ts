import pino, { type Logger as PinoLogger } from 'pino';

import { commonEnv } from '@/server/infra/config/env-common';
import {
  REDACTED,
  sanitizeHeaders,
  sanitizeLogUrl,
  sanitizeLogValue,
  serializeLogError,
} from '@/server/infra/logging/log-redaction';

/**
 * Project logging facade over pino.
 *
 * Call sites should use `createLogger('ModuleName')` (or the named helpers below).
 * Do not import `pino` elsewhere. If the sink later moves to a hosted log
 * service / shipper, adapt only this module — keep the `AppLogger` shape stable.
 */

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

/** Stable surface for app / jobs code — pino-compatible `(fields, msg)` / `(msg)`. */
export type AppLogger = Pick<PinoLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'child' | 'level'>;

export type LoggerBindings = {
  /** Logical module / feature prefix (shown in pretty output as `{module}: {msg}`). */
  module: string;
  /** Process role when useful for multi-service log aggregation. */
  service?: 'app' | 'jobs';
  [key: string]: unknown;
};

const rootPino: PinoLogger = pino({
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

/**
 * Create a module-scoped logger. Prefer this over touching the underlying library.
 *
 * @example
 * const log = createLogger('Tts');
 * log.info({ key, cacheOutcome: 'hit' }, 'TTS cache hit');
 * log.warn({ err }, 'Redis TTS cache read failed');
 */
export function createLogger(module: string, extra?: Omit<LoggerBindings, 'module'>): AppLogger {
  return rootPino.child({ module, ...extra });
}

export const dbLogger = createLogger('Database');
export const redisLogger = createLogger('Redis');
export const queueLogger = createLogger('Queue');
export const workerLogger = createLogger('Worker', { service: 'jobs' });
export const authLogger = createLogger('Auth');
export const serverLogger = createLogger('Server', { service: 'app' });
