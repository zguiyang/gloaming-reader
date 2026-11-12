import { discoverSaveBodySchema } from '@/shared/discovery';

import { ensureSourceRecordForDiscoverSave } from '@/server/domains/discovery';
import { saveSourceRecordToLibrary } from '@/server/domains/library/save-intent';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

/**
 * Save a remote Discover candidate: upsert SourceRecord from OPDS, then create
 * the Save Intent / enqueue materialization.
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

    let sourceRecord;
    try {
      sourceRecord = await ensureSourceRecordForDiscoverSave(parsed.data);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unsupported discovery source')) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
      }
      if (error instanceof Error && error.message.includes('is disabled')) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
      }
      throw error;
    }

    const result = await saveSourceRecordToLibrary(identity.user.id, sourceRecord.id);
    return jsonOk({ ...result, sourceRecordId: sourceRecord.id });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
