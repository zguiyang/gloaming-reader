import type {
  AssetCategory,
  AssetCategorySummary,
  AssetCleanupJobStatus,
  AssetObjectStatus,
} from '@gloaming/shared/assets';

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  audio: '音频',
  cover: '封面',
  image: '插图',
  origin: '原始文件',
  other: '其他',
};

const STATUS_LABELS: Record<AssetObjectStatus, string> = {
  referenced: '正常',
  orphan: '孤儿',
  missing: '缺失',
  legacy_duplicate_audio: '历史重复音频',
};

const CLEANUP_JOB_STATUS_LABELS: Record<AssetCleanupJobStatus, string> = {
  queued: '排队中',
  running: '清理中',
  completed: '已完成',
  partial: '部分失败',
  failed: '失败',
};

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export function assetCategoryLabel(category: AssetCategory): string {
  return CATEGORY_LABELS[category];
}

export function assetStatusLabel(status: AssetObjectStatus): string {
  return STATUS_LABELS[status];
}

export function assetCleanupJobStatusLabel(status: AssetCleanupJobStatus): string {
  return CLEANUP_JOB_STATUS_LABELS[status];
}

/** Compact duration for admin scan metadata. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
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

export function formatMeasuredAt(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function buildCategoryChartData(categories: AssetCategorySummary[]) {
  return categories
    .filter((entry) => entry.bytes > 0)
    .map((entry, index) => ({
      category: entry.category,
      label: assetCategoryLabel(entry.category),
      bytes: entry.bytes,
      objectCount: entry.objectCount,
      fill: CHART_COLORS[index % CHART_COLORS.length]!,
    }));
}
