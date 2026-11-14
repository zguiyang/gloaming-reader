import { updateLlmModelBodySchema } from '@/shared/llm';

import * as llmModelsService from '@/server/domains/llm/config/models/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withApiError(async (request: Request, context: Ctx) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  const id = pathId((await context.params).id, 'id');

  const raw = await request.json().catch(() => null);
  const parsed = updateLlmModelBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  return jsonOk(await llmModelsService.updateModel(id, parsed.data));
});

export const DELETE = withApiError(async (request: Request, context: Ctx) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  const id = pathId((await context.params).id, 'id');
  await llmModelsService.deleteModel(id);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});
