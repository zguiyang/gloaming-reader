import { type Locale, t } from '@gloaming/i18n';
import type {
  AssetCategory,
  AssetCategorySummary,
  AssetCleanupJobStatus,
  AssetObjectStatus,
} from '@gloaming/shared/assets';

const CATEGORY_KEYS: Record<AssetCategory, string> = {
  audio: 'audio',
  cover: 'cover',
  image: 'image',
  origin: 'origin',
  other: 'other',
};

const STATUS_KEYS: Record<AssetObjectStatus, string> = {
  referenced: 'referenced',
  orphan: 'orphan',
  missing: 'missing',
  legacy_duplicate_audio: 'legacyDuplicateAudio',
};

const CLEANUP_JOB_STATUS_KEYS: Record<AssetCleanupJobStatus, string> = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  partial: 'partial',
  failed: 'failed',
};

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export function assetCategoryLabel(category: AssetCategory, locale: Locale): string {
  return t(locale, `admin.assets.enum.category.${CATEGORY_KEYS[category]}`);
}

export function assetStatusLabel(status: AssetObjectStatus, locale: Locale): string {
  return t(locale, `admin.assets.enum.status.${STATUS_KEYS[status]}`);
}

export function assetCleanupJobStatusLabel(status: AssetCleanupJobStatus, locale: Locale): string {
  return t(locale, `admin.assets.enum.cleanupJobStatus.${CLEANUP_JOB_STATUS_KEYS[status]}`);
}

/** Compact duration for admin scan metadata. */
export function formatDurationMs(ms: number, locale: Locale): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return t(locale, 'admin.assets.format.durationZero');
  }
  if (ms < 1000) {
    return t(locale, 'admin.assets.format.durationMs', { ms: Math.round(ms) });
  }
  return t(locale, 'admin.assets.format.durationSeconds', { seconds: (ms / 1000).toFixed(1) });
}

/** Human-readable byte size for admin storage summaries. */
export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 1000 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function shortObjectKey(key: string): string {
  const parts = key.split('/');
  if (parts.length <= 2) return key;
  return `…/${parts.slice(-2).join('/')}`;
}

export function formatMeasuredAt(value: string | Date, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function buildCategoryChartData(categories: AssetCategorySummary[], locale: Locale) {
  return categories
    .filter((entry) => entry.bytes > 0)
    .map((entry, index) => ({
      category: entry.category,
      label: assetCategoryLabel(entry.category, locale),
      bytes: entry.bytes,
      objectCount: entry.objectCount,
      fill: CHART_COLORS[index % CHART_COLORS.length]!,
    }));
}
