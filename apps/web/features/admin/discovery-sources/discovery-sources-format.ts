import { type Locale, t } from '@gloaming/i18n';
import type { DiscoverySourceSyncStatus } from '@gloaming/shared/discovery';

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
