import type { Context } from 'hono';

import { type Locale, resolveLocale } from '@gloaming/i18n';

/** Resolve the request locale from the Accept-Language header. */
export function resolveRequestLocale(c: Context): Locale {
  return resolveLocale(c.req.header('accept-language'));
}
