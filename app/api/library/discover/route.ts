import { discoverSaveBodySchema } from '@/shared/discovery';

import { ensureSourceRecordForDiscoverSave } from '@/server/domains/discovery';
import { saveSourceRecordToLibrary } from '@/server/domains/library/save-intent';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

/**
 * Save a remote Discover candidate: upsert SourceRecord from OPDS, then create
 * the Save Intent / enqueue materialization.
 *
 * Domain failures already carry stable `AppError` codes, so mapping them by
 * `error.message` here was both brittle and unnecessary.
 */
export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const body = await request.json().catch(() => null);
  const parsed = discoverSaveBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  const sourceRecord = await ensureSourceRecordForDiscoverSave(parsed.data);
  const result = await saveSourceRecordToLibrary(identity.user.id, sourceRecord.id);
  return jsonOk({ ...result, sourceRecordId: sourceRecord.id });
});
