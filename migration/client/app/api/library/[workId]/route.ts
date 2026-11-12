import { addToLibrary, removeFromLibrary } from '@/server/domains/library/service';
import { jsonFromThrown } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId } = await context.params;
    await addToLibrary(identity.user.id, workId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function DELETE(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { workId } = await context.params;
    await removeFromLibrary(identity.user.id, workId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
