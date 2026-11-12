import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
} from '@/server/domains/discovery/gutenberg/constants';

/** Code-registered Discover adapters. Rows are ensured in `discovery_source` on read. */
export type RegisteredDiscoverySource = {
  readonly sourceKey: string;
  readonly sourceType: string;
};

/**
 * V1 supported sources. Add new adapters here; admin list and Discover picker
 * are driven from this registry plus the `enabled` flag on each DB row.
 */
export const REGISTERED_DISCOVERY_SOURCES: readonly RegisteredDiscoverySource[] = [
  {
    sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
    sourceType: PROJECT_GUTENBERG_SOURCE_TYPE,
  },
] as const;

export function getRegisteredDiscoverySource(sourceKey: string): RegisteredDiscoverySource | null {
  return REGISTERED_DISCOVERY_SOURCES.find((source) => source.sourceKey === sourceKey) ?? null;
}
