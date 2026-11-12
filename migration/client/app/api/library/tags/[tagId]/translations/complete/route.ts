import { completeUserTagTranslations } from '@/server/domains/library/tags/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tagId: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { tagId } = await context.params;
    return jsonOk(await completeUserTagTranslations(identity.user.id, tagId));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
