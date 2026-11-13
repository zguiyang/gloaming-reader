import { discoverSaveBodySchema } from '@/shared/discovery';

import { ensureSourceRecordForDiscoverSave } from '@/server/domains/discovery';
import { saveSourceRecordToLibrary } from '@/server/domains/library/save-intent';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

/**
 * Save a remote Discover candidate: upsert SourceRecord from OPDS, then create
 * the Save Intent / enqueue materialization.
 *
 * Domain failures already carry stable `AppError` codes, so mapping them by
 * `error.message` here was both brittle and unnecessary.
 */
export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const body = await request.json().catch(() => null);
    const parsed = discoverSaveBodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const sourceRecord = await ensureSourceRecordForDiscoverSave(parsed.data);
    const result = await saveSourceRecordToLibrary(identity.user.id, sourceRecord.id);
    return jsonOk({ ...result, sourceRecordId: sourceRecord.id });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
