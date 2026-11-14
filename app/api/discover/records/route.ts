import { sourceRecordListQuerySchema } from '@/shared/discovery';

import { listSourceRecords } from '@/server/domains/discovery/read-model';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { resolveRequestLocale } from '@/server/infra/http/locale';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = sourceRecordListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }
  const identity = await getRequestIdentity(request);
  const data = await listSourceRecords(parsed.data, {
    locale: resolveRequestLocale(request),
    actor: workReadActorFromIdentity(identity.user),
  });
  return jsonOk(data);
});
