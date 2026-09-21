import { commonEnv } from '@/lib/env-common';

export const SCAN_LOCK_KEY = 'asset-management:scan:lock';
export const SCAN_LOCK_TTL_SECONDS = 120;

export function snapshotTtlSeconds(): number {
  return commonEnv.NODE_ENV === 'production' ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
}
