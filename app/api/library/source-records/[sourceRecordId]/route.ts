import { readSourceRecordSaveStatus, saveSourceRecordToLibrary } from '@/server/domains/library/save-intent';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sourceRecordId: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const sourceRecordId = pathId((await context.params).sourceRecordId, 'sourceRecordId');
  const status = await readSourceRecordSaveStatus(identity.user.id, sourceRecordId);
  return jsonOk(status);
});

export const POST = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const sourceRecordId = pathId((await context.params).sourceRecordId, 'sourceRecordId');
  const result = await saveSourceRecordToLibrary(identity.user.id, sourceRecordId);
  return jsonOk(result);
});
