import { getLibraryItem } from '@/server/domains/library/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const workId = pathId((await context.params).workId, 'workId');
    return jsonOk(await getLibraryItem(identity.user.id, workId));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
