import { z } from 'zod';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n';
import { userTagWriteSchema } from '@/shared/library';

import { createUserTag, listUserTags } from '@/server/domains/library/tags/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

const localeTagWriteSchema = userTagWriteSchema.extend({ locale: z.enum(SUPPORTED_LOCALES).optional() });

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  return jsonOk(await listUserTags(identity.user.id));
});

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  const raw = await request.json().catch(() => null);
  const parsed = localeTagWriteSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }
  const input = parsed.data;
  const tag = await createUserTag(identity.user.id, input.name, input.locale ?? DEFAULT_LOCALE);
  return jsonOk(tag, { status: HTTP_STATUS.CREATED });
});
