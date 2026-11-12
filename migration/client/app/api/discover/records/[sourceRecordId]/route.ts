import { getSourceRecord } from '@/server/domains/discovery/read-model';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { resolveRequestLocale } from '@/server/infra/http/locale';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sourceRecordId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const { sourceRecordId } = await context.params;
    const identity = await getRequestIdentity(request);
    const record = await getSourceRecord(sourceRecordId, {
      locale: resolveRequestLocale(request),
      actor: workReadActorFromIdentity(identity.user),
    });
    return jsonOk(record);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
