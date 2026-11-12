import { and, eq, type SQL, sql } from 'drizzle-orm';

import { discoverySource, sourceRecord } from '@gloaming/db/schema';
import { DISCOVERY_DEFAULT_LANGUAGE } from '@gloaming/shared/discovery';

/**
 * Public Discover visibility rules, shared by the record list and the public
 * category counts so both surfaces always describe the same set of records.
 */

/** Only records the last successful sync observed as available are discoverable. */
export function availableRecordFilter(): SQL {
  return eq(sourceRecord.availability, 'available');
}

/** A source must be enabled for any of its records to be publicly readable. */
export function enabledSourceFilter(): SQL {
  return eq(discoverySource.enabled, true);
}

/** English-first via the existing `languages` GIN index; persisted rows are untouched. */
export function languageFilter(language: string): SQL {
  return sql`${sourceRecord.languages} @> ARRAY[${language}]::text[]`;
}

/**
 * Full public visibility: available record on an enabled source in the given
 * content language (defaulting to the shared Discover language default).
 */
export function publicDiscoverableRecordWhere(language: string = DISCOVERY_DEFAULT_LANGUAGE): SQL {
  return and(availableRecordFilter(), enabledSourceFilter(), languageFilter(language))!;
}
