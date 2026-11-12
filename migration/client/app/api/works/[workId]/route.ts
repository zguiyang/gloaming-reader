import {
  personalWorkDeleteResultSchema,
  personalWorkUpdateResultSchema,
  personalWorkUpdateSchema,
} from '@gloaming/shared/works';

import { deletePersonalWork, updatePersonalWork } from '@/server/domains/works/personal/management';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = personalWorkUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const result = await updatePersonalWork(identity.user.id, workId, parsed.data);
    return jsonOk(personalWorkUpdateResultSchema.parse(result));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function DELETE(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId } = await context.params;
    const result = await deletePersonalWork(identity.user.id, workId);
    return jsonOk(personalWorkDeleteResultSchema.parse(result));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
