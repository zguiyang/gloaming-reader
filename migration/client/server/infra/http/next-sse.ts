import { t } from '@gloaming/i18n';

import { getClientLocale } from '@/lib/client-locale';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export type LocalizedApiErrorBody = {
  error: string;
  code: string;
};

export function formatThrownErrorBody(request: Request, error: unknown): LocalizedApiErrorBody {
  const locale = getClientLocale({ acceptLanguage: request.headers.get('accept-language') });
  if (error instanceof AppError) {
    return { error: t(locale, error.code, error.params), code: error.code };
  }
  return {
    error: t(locale, ERROR_CODES.INTERNAL_SERVER_ERROR),
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
  };
}

export function sseResponseHeaders(): HeadersInit {
  return {
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'Content-Type': 'text/event-stream',
  };
}

export function encodeSseMessage(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}
