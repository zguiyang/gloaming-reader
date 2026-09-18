import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { t, type TranslationParams } from '@gloaming/i18n';

import { AppError, type ValidationDetail } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { resolveRequestLocale } from '@/lib/locale';

export type LocalizedApiErrorBody = {
  error: string;
  code: string;
};

export function localizeErrorCode(c: Context, code: string, params?: TranslationParams): LocalizedApiErrorBody {
  const locale = resolveRequestLocale(c);
  return { error: t(locale, code, params), code };
}

/** Map a thrown AppError (or unknown) to a localized API error payload. */
export function formatThrownError(c: Context, error: unknown): LocalizedApiErrorBody {
  if (error instanceof AppError) {
    return localizeErrorCode(c, error.code, error.params);
  }
  return localizeErrorCode(c, ERROR_CODES.INTERNAL_SERVER_ERROR);
}

export function sendError(c: Context, code: string, status: ContentfulStatusCode, params?: TranslationParams) {
  const locale = resolveRequestLocale(c);
  return c.json({ error: t(locale, code, params), code }, status);
}

export function sendValidationError(c: Context, details: ValidationDetail[]) {
  const locale = resolveRequestLocale(c);
  const localizedDetails = details.map((detail) => {
    const code = detail.code ?? ERROR_CODES.VALIDATION_INVALID_INPUT;
    const message = t(locale, code, detail.params);
    return { path: detail.path, message, code };
  });
  return c.json(
    {
      error: t(locale, ERROR_CODES.VALIDATION_FAILED),
      code: ERROR_CODES.VALIDATION_FAILED,
      details: localizedDetails,
    },
    400 as ContentfulStatusCode,
  );
}
