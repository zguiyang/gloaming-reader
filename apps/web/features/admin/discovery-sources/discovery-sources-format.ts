import { type Locale, t } from '@gloaming/i18n';
import type { DiscoverySourceSyncStatus, DiscoverySyncRunStage } from '@gloaming/shared/discovery';

const SYNC_STATUS_KEYS: Record<DiscoverySourceSyncStatus, string> = {
  idle: 'idle',
  queued: 'queued',
  syncing: 'syncing',
  succeeded: 'succeeded',
  failed: 'failed',
};

export function discoverySyncStatusLabel(status: DiscoverySourceSyncStatus, locale: Locale): string {
  return t(locale, `admin.discoverySources.enum.syncStatus.${SYNC_STATUS_KEYS[status]}`);
}

const RUN_STAGE_KEYS: Record<DiscoverySyncRunStage, string> = {
  queued: 'queued',
  downloading: 'downloading',
  processing: 'processing',
  reconciling: 'reconciling',
  succeeded: 'succeeded',
  not_modified: 'notModified',
  skipped: 'skipped',
  failed: 'failed',
};

/** Localized run-stage label; wording stays truthful (no fabricated percentages). */
export function discoverySyncRunStageLabel(stage: DiscoverySyncRunStage, locale: Locale): string {
  return t(locale, `admin.discoverySources.enum.runStage.${RUN_STAGE_KEYS[stage]}`);
}

/**
 * Elapsed wall-clock time for a run, in whole minutes and seconds (e.g. `2m 05s`).
 * A completed run freezes at `finishedAt - start`; only a still-running run
 * grows with `now` (defaults to the real clock).
 */
export function formatDiscoveryElapsed(
  start: string | Date | null,
  locale: Locale,
  options: { finishedAt?: string | Date | null; now?: Date } = {},
): string {
  const startDate = start instanceof Date ? start : start ? new Date(start) : null;
  const finishedDate =
    options.finishedAt instanceof Date ? options.finishedAt : options.finishedAt ? new Date(options.finishedAt) : null;
  const now = options.now ?? new Date();
  const endMs = finishedDate && Number.isFinite(finishedDate.getTime()) ? finishedDate.getTime() : now.getTime();
  const elapsedMs = startDate && Number.isFinite(startDate.getTime()) ? Math.max(0, endMs - startDate.getTime()) : 0;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return t(locale, 'admin.discoverySources.value.elapsed', { minutes, seconds: String(seconds).padStart(2, '0') });
}

/** Compact timestamp for admin status rows; `null` renders the localized "never". */
export function formatDiscoveryTimestamp(value: string | Date | null, locale: Locale): string {
  if (!value) {
    return t(locale, 'admin.discoverySources.value.never');
  }
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
    hour12: false,
  }).format(date);
}
