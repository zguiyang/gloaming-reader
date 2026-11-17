/**
 * Thin job contract for discovery catalog sync.
 * Keep this free of domain/queue imports so Next boot and queue modules can
 * reference the name/payload without loading the sync processor.
 */

export const JOB_DISCOVERY_SYNC = 'discovery-sync';

export type DiscoverySyncJobData = {
  sourceKey: string;
  /** ISO claim token for admin-enqueued jobs. */
  claimedAt?: string;
  /** Scheduled jobs claim inside the worker. */
  trigger?: 'schedule';
  /** Explicit full refresh without `If-Modified-Since`. */
  force?: boolean;
};
