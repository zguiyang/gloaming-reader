import { readSourceRecordSaveStatus, saveSourceRecordToLibrary } from '@/server/domains/library/save-intent';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sourceRecordId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const sourceRecordId = pathId((await context.params).sourceRecordId, 'sourceRecordId');
    const status = await readSourceRecordSaveStatus(identity.user.id, sourceRecordId);
    return jsonOk(status);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const sourceRecordId = pathId((await context.params).sourceRecordId, 'sourceRecordId');
    const result = await saveSourceRecordToLibrary(identity.user.id, sourceRecordId);
    return jsonOk(result);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
