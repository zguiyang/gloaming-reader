import { type Locale, resolveLocale } from '@/i18n';

/** Resolve the request locale from the Accept-Language header. */
export function resolveRequestLocale(request: Request): Locale {
  return resolveLocale(request.headers.get('accept-language'));
}
