import { assignUserTag, unassignUserTag } from '@/server/domains/library/tags/service';
import { jsonFromThrown } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string; tagId: string }> };

export async function PUT(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const params = await context.params;
    const workId = pathId(params.workId, 'workId');
    const tagId = pathId(params.tagId, 'tagId');
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
    const params = await context.params;
    const workId = pathId(params.workId, 'workId');
    const tagId = pathId(params.tagId, 'tagId');
    await unassignUserTag(identity.user.id, workId, tagId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
