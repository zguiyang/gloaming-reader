import { eq } from 'drizzle-orm';

import { discoverySource as discoverySourceTable } from '@/server/db/schema';
import type { DiscoverySourceListData, DiscoverySourceSummary } from '@/shared/discovery';

import { ensureDiscoverySource } from '@/server/domains/discovery/persist/source-record';
import {
  getRegisteredDiscoverySource,
  REGISTERED_DISCOVERY_SOURCES,
} from '@/server/domains/discovery/sources/registry';
import { db } from '@/server/infra/db';
import { AppError, NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { HTTP_STATUS } from '@/server/shared/constants';

async function ensureRegisteredRows(): Promise<void> {
  for (const source of REGISTERED_DISCOVERY_SOURCES) {
    await ensureDiscoverySource(source.sourceKey, source.sourceType);
  }
}

function toSummary(row: { sourceKey: string; sourceType: string; enabled: boolean }): DiscoverySourceSummary {
  return {
    sourceKey: row.sourceKey,
    sourceType: row.sourceType,
    enabled: row.enabled,
  };
}

/** Admin: all registered sources with current enabled state (default on). */
export async function listAdminDiscoverySources(): Promise<DiscoverySourceListData> {
  await ensureRegisteredRows();
  const rows = await db.select().from(discoverySourceTable);
  const byKey = new Map(rows.map((row) => [row.sourceKey, row]));

  return {
    items: REGISTERED_DISCOVERY_SOURCES.map((registered) => {
      const row = byKey.get(registered.sourceKey);
      return toSummary({
        sourceKey: registered.sourceKey,
        sourceType: row?.sourceType ?? registered.sourceType,
        enabled: row?.enabled ?? true,
      });
    }),
  };
}

/** Public Discover: only enabled registered sources. */
export async function listEnabledDiscoverySources(): Promise<DiscoverySourceListData> {
  const all = await listAdminDiscoverySources();
  return { items: all.items.filter((item) => item.enabled) };
}

export async function setDiscoverySourceEnabled(sourceKey: string, enabled: boolean): Promise<DiscoverySourceSummary> {
  const registered = getRegisteredDiscoverySource(sourceKey);
  if (!registered) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  const row = await ensureDiscoverySource(registered.sourceKey, registered.sourceType);
  const [updated] = await db
    .update(discoverySourceTable)
    .set({ enabled })
    .where(eq(discoverySourceTable.id, row.id))
    .returning();

  return toSummary(updated ?? { ...row, enabled });
}

export async function isDiscoverySourceEnabled(sourceKey: string): Promise<boolean> {
  const registered = getRegisteredDiscoverySource(sourceKey);
  if (!registered) return false;
  const row = await ensureDiscoverySource(registered.sourceKey, registered.sourceType);
  return row.enabled;
}

/** Throws when the source is unknown or disabled for Discover/Save. */
export async function assertDiscoverySourceEnabled(sourceKey: string): Promise<void> {
  const registered = getRegisteredDiscoverySource(sourceKey);
  if (!registered) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
  }
  if (!(await isDiscoverySourceEnabled(sourceKey))) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }
}
