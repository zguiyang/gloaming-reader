import { z } from 'zod';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n';
import { userTagWriteSchema } from '@/shared/library';

import { deleteUserTag, renameUserTag } from '@/server/domains/library/tags/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

const localeTagWriteSchema = userTagWriteSchema.extend({ locale: z.enum(SUPPORTED_LOCALES).optional() });

type Ctx = { params: Promise<{ tagId: string }> };

export const PATCH = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const tagId = pathId((await context.params).tagId, 'tagId');
  const raw = await request.json().catch(() => null);
  const parsed = localeTagWriteSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }
  const input = parsed.data;
  return jsonOk(await renameUserTag(identity.user.id, tagId, input.name, input.locale ?? DEFAULT_LOCALE));
});

export const DELETE = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const tagId = pathId((await context.params).tagId, 'tagId');
  await deleteUserTag(identity.user.id, tagId);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});
