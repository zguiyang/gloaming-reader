import { getLibraryItem } from '@/server/domains/library/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId } = await context.params;
    return jsonOk(await getLibraryItem(identity.user.id, workId));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
