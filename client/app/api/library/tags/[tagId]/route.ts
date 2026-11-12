import { z } from 'zod';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n';
import { userTagWriteSchema } from '@/shared/library';

import { deleteUserTag, renameUserTag } from '@/server/domains/library/tags/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

const localeTagWriteSchema = userTagWriteSchema.extend({ locale: z.enum(SUPPORTED_LOCALES).optional() });

type Ctx = { params: Promise<{ tagId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { tagId } = await context.params;
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
    return jsonOk(await renameUserTag(identity.user.id, tagId, input.name, input.locale ?? DEFAULT_LOCALE));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function DELETE(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { tagId } = await context.params;
    await deleteUserTag(identity.user.id, tagId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
