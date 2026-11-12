import { assignUserTag, unassignUserTag } from '@/server/domains/library/tags/service';
import { jsonFromThrown } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string; tagId: string }> };

export async function PUT(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId, tagId } = await context.params;
    await assignUserTag(identity.user.id, workId, tagId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function DELETE(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId, tagId } = await context.params;
    await unassignUserTag(identity.user.id, workId, tagId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
