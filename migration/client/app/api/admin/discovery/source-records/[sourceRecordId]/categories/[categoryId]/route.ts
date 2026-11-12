import { assignCategoryToSourceRecord, unassignCategoryFromSourceRecord } from '@/server/domains/discovery/categories';
import { jsonFromThrown } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sourceRecordId: string; categoryId: string }> };

export async function PUT(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { sourceRecordId, categoryId } = await context.params;
    await assignCategoryToSourceRecord(sourceRecordId, categoryId, 'manual');
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function DELETE(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { sourceRecordId, categoryId } = await context.params;
    await unassignCategoryFromSourceRecord(sourceRecordId, categoryId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
