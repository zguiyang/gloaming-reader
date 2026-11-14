import { createLlmModelBodySchema, llmModelListQuerySchema } from '@/shared/llm';

import * as llmModelsService from '@/server/domains/llm/config/models/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const url = new URL(request.url);
  const parsed = llmModelListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }

  return jsonOk(await llmModelsService.listModels(parsed.data));
});

export const POST = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const raw = await request.json().catch(() => null);
  const parsed = createLlmModelBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  const model = await llmModelsService.createModel(parsed.data);
  return jsonOk(model, { status: HTTP_STATUS.CREATED });
});
