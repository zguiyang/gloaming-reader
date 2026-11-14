import { getLibrary } from '@/server/domains/library/service';
import { jsonOk } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  const data = await getLibrary(identity.user.id);
  return jsonOk(data);
});
