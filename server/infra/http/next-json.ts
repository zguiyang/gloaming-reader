import type { ZodError, ZodType } from 'zod';

import { t, type TranslationParams } from '@/i18n';

import { getClientLocale } from '@/lib/client-locale';
import { rootLogger } from '@/server/infra/logging/logger';
import { AppError, ValidationFailedError, type ValidationDetail } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const jsonLogger = rootLogger.child({ module: 'NextJson' });

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
    // Callers forward a concrete reason (custom message or i18n code); fall
    // back to the shared generic message only when neither is available.
    const message = detail.message?.trim() ? detail.message : t(locale, code, detail.params);
    return { path: detail.path, message, code };
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

type SchemaIssue = ZodError['issues'][number];

/** Our own schema messages are i18n keys; zod built-ins are English prose. */
function isMessageKey(message: string): boolean {
  return /^[a-z][\w]*(\.[\w]+)+$/.test(message);
}

function detailFromSchemaIssue(issue: SchemaIssue, defaultPath: string): ValidationDetail {
  const path = issue.path.join('.') || defaultPath;
  if (isMessageKey(issue.message)) {
    // Localize through the code path so the response carries display text.
    return { path, code: issue.message };
  }
  switch (issue.code) {
    case 'too_big': {
      const max = Number(issue.maximum);
      return Number.isFinite(max)
        ? { path, code: 'api.errors.validation.tooBig', params: { max } }
        : { path, code: ERROR_CODES.VALIDATION_INVALID_INPUT };
    }
    case 'too_small': {
      const min = Number(issue.minimum);
      return Number.isFinite(min)
        ? { path, code: 'api.errors.validation.tooSmall', params: { min } }
        : { path, code: ERROR_CODES.VALIDATION_INVALID_INPUT };
    }
    case 'invalid_type':
      return { path, code: 'api.errors.validation.invalidType', params: { expected: issue.expected } };
    case 'invalid_format':
      return { path, code: 'api.errors.validation.invalidFormat' };
    case 'invalid_value':
      return { path, code: 'api.errors.validation.invalidValue' };
    case 'unrecognized_keys':
      return { path, code: 'api.errors.validation.unrecognizedKeys' };
    default:
      return { path, code: ERROR_CODES.VALIDATION_INVALID_INPUT };
  }
}

/** Map a zod parse failure to the shared 400 validation contract. */
export function jsonSchemaError(request: Request, error: ZodError, defaultPath = 'body'): Response {
  return jsonValidationError(
    request,
    error.issues.map((issue) => detailFromSchemaIssue(issue, defaultPath)),
  );
}

export type ParsedJsonBody<T> = { data: T } | { response: Response };

/**
 * Read and validate a JSON body, returning either the parsed data or the shared
 * 400 response. Keeps the request/safeParse/error block out of every route.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  defaultPath = 'body',
): Promise<ParsedJsonBody<T>> {
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { response: jsonSchemaError(request, parsed.error, defaultPath) };
  }
  return { data: parsed.data };
}

/** Validate `URL.searchParams` with the same 400 contract as JSON bodies. */
export function parseSearchParams<T>(
  url: URL,
  request: Request,
  schema: ZodType<T>,
  defaultPath = 'query',
): ParsedJsonBody<T> {
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return { response: jsonSchemaError(request, parsed.error, defaultPath) };
  }
  return { data: parsed.data };
}

export function jsonFromThrown(request: Request, error: unknown): Response {
  if (error instanceof ValidationFailedError) {
    // Field-level details are part of the error contract; dropping them made
    // every domain-side validation failure look like a bare 400.
    return jsonValidationError(request, error.details);
  }
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
  // Structured logger: `console.error` bypasses the redaction pipeline, so raw
  // driver errors could carry connection strings into the log stream.
  jsonLogger.error({ err: error }, 'Unhandled request error');
  return jsonError(request, ERROR_CODES.INTERNAL_SERVER_ERROR, 500);
}
