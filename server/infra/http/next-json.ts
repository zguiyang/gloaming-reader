import { t, type TranslationParams } from '@/i18n';

import { getClientLocale } from '@/lib/client-locale';
import { AppError, type ValidationDetail } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

function localeFromRequest(request: Request): ReturnType<typeof getClientLocale> {
  return getClientLocale({
    acceptLanguage: request.headers.get('accept-language'),
  });
}

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function jsonError(request: Request, code: string, status: number, params?: TranslationParams): Response {
  const locale = localeFromRequest(request);
  return Response.json({ error: t(locale, code, params), code }, { status });
}

export function jsonValidationError(request: Request, details: ValidationDetail[]): Response {
  const locale = localeFromRequest(request);
  const localizedDetails = details.map((detail) => {
    const code = detail.code ?? ERROR_CODES.VALIDATION_INVALID_INPUT;
    return { path: detail.path, message: t(locale, code, detail.params), code };
  });
  return Response.json(
    {
      error: t(locale, ERROR_CODES.VALIDATION_FAILED),
      code: ERROR_CODES.VALIDATION_FAILED,
      details: localizedDetails,
    },
    { status: 400 },
  );
}

export function jsonFromThrown(request: Request, error: unknown): Response {
  if (error instanceof AppError) {
    return jsonError(request, error.code, error.statusCode, error.params);
  }
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    const code = (error as Error & { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      return jsonError(request, code, status);
    }
  }
  console.error(error);
  return jsonError(request, ERROR_CODES.INTERNAL_SERVER_ERROR, 500);
}
