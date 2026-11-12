import { z } from 'zod';

import {
  getPersonalTaggingPreference,
  setPersonalTaggingPreference,
} from '@/server/domains/library/tags/personal-ai-tagging';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

const personalTaggingSchema = z.object({ enabled: z.boolean() });

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    return jsonOk(await getPersonalTaggingPreference(identity.user.id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const raw = await request.json().catch(() => null);
    const parsed = personalTaggingSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    await setPersonalTaggingPreference(identity.user.id, parsed.data.enabled);
    return jsonOk(await getPersonalTaggingPreference(identity.user.id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
