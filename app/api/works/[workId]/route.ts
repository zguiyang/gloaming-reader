import {
  personalWorkDeleteResultSchema,
  personalWorkUpdateResultSchema,
  personalWorkUpdateSchema,
} from '@/shared/works';

import { deletePersonalWork, updatePersonalWork } from '@/server/domains/works/personal/management';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export const PATCH = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const workId = pathId((await context.params).workId, 'workId');
  const raw = await request.json().catch(() => null);
  const parsed = personalWorkUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }
  const result = await updatePersonalWork(identity.user.id, workId, parsed.data);
  return jsonOk(personalWorkUpdateResultSchema.parse(result));
});

export const DELETE = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const workId = pathId((await context.params).workId, 'workId');
  const result = await deletePersonalWork(identity.user.id, workId);
  return jsonOk(personalWorkDeleteResultSchema.parse(result));
});
