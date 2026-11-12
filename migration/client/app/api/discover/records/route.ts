import { sourceRecordListQuerySchema } from '@gloaming/shared/discovery';

import { listSourceRecords } from '@/server/domains/discovery/read-model';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { resolveRequestLocale } from '@/server/infra/http/locale';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = sourceRecordListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }
    const identity = await getRequestIdentity(request);
    const data = await listSourceRecords(parsed.data, {
      locale: resolveRequestLocale(request),
      actor: workReadActorFromIdentity(identity.user),
    });
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
