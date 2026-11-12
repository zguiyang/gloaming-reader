import { deleteManagedCategory } from '@/server/domains/discovery/categories';
import { jsonFromThrown } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ categoryId: string }> };

export async function DELETE(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { categoryId } = await context.params;
    await deleteManagedCategory(categoryId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
