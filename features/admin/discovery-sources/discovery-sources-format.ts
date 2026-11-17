import { t, type Locale } from '@/i18n';

import type { DiscoverySourceSyncStatus, DiscoverySyncRunStage } from '@/shared/discovery';

export function discoverySyncStatusLabel(status: DiscoverySourceSyncStatus, locale: Locale): string {
  return t(locale, `admin.discoverySources.syncStatus.${status}`);
}

export function discoverySyncRunStageLabel(stage: DiscoverySyncRunStage, locale: Locale): string {
  return t(locale, `admin.discoverySources.run.stages.${stage}`);
}

export function formatDiscoveryTimestamp(value: string | Date | null, locale: Locale): string {
  if (!value) return t(locale, 'admin.discoverySources.never');
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return t(locale, 'admin.discoverySources.never');
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDiscoveryElapsed(
  startedAt: string | Date,
  finishedAt: string | Date | null,
  locale: Locale,
): string {
  const start = (startedAt instanceof Date ? startedAt : new Date(startedAt)).getTime();
  const end = finishedAt ? (finishedAt instanceof Date ? finishedAt : new Date(finishedAt)).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return t(locale, 'admin.discoverySources.run.elapsedUnknown');
  }
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return t(locale, 'admin.discoverySources.run.elapsedSeconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return t(locale, 'admin.discoverySources.run.elapsedMinutes', { minutes, seconds: rem });
}
