import type { Locale } from '@/i18n';

/**
 * Locale-aware `YYYY-MM-DD HH:mm` (24h) label used by admin tables. Invalid
 * inputs fall back to the original value so rows never show "Invalid Date".
 */
export function formatDateTimeValue(
  value: string | Date,
  locale: Locale,
  options: { withSeconds?: boolean } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(date);
}
