import { getReaderPart } from '@/server/domains/reading/reader';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ partId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const { partId } = await context.params;
    const identity = await getRequestIdentity(request);
    const actor = workReadActorFromIdentity(identity.user);
    const data = await getReaderPart(actor, partId);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
