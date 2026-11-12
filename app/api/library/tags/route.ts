import { z } from 'zod';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n';
import { userTagWriteSchema } from '@/shared/library';

import { createUserTag, listUserTags } from '@/server/domains/library/tags/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

const localeTagWriteSchema = userTagWriteSchema.extend({ locale: z.enum(SUPPORTED_LOCALES).optional() });

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    return jsonOk(await listUserTags(identity.user.id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const raw = await request.json().catch(() => null);
    const parsed = localeTagWriteSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const input = parsed.data;
    const tag = await createUserTag(identity.user.id, input.name, input.locale ?? DEFAULT_LOCALE);
    return jsonOk(tag, { status: HTTP_STATUS.CREATED });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
