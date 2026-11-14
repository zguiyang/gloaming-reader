import { getReadingHistory } from '@/server/domains/reading/history/query';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  const actor = workReadActorFromIdentity(identity.user);
  const data = await getReadingHistory(actor, identity.user.id);
  return jsonOk(data);
});
