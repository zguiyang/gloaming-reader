import { createLlmModelBodySchema, llmModelListQuerySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const url = new URL(request.url);
  const parsed = llmModelListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }

  return jsonOk(await userLlmConfig.listUserModels(identity.user.id, parsed.data));
});

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const raw = await request.json().catch(() => null);
  const parsed = createLlmModelBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  const model = await userLlmConfig.createUserModel(identity.user.id, parsed.data);
  return jsonOk(model, { status: HTTP_STATUS.CREATED });
});
