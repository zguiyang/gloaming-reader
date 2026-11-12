import { updateReadingStateBodySchema } from '@/shared/reader';

import { getReadingState, updateReadingState } from '@/server/domains/reading/reader';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId } = await context.params;
    const actor = workReadActorFromIdentity(identity.user);
    const state = await getReadingState(actor, identity.user.id, workId);
    return jsonOk({ state });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function PATCH(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = updateReadingStateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const actor = workReadActorFromIdentity(identity.user);
    const state = await updateReadingState(actor, identity.user.id, workId, parsed.data);
    return jsonOk(state);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
