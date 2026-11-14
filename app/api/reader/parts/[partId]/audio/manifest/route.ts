import { readerAudioManifestQuerySchema } from '@/shared/reader';

import { getReaderAudioManifest } from '@/server/domains/reader-audio/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ partId: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const partId = pathId((await context.params).partId, 'partId');
  const identity = await getRequestIdentity(request);
  const url = new URL(request.url);
  const parsed = readerAudioManifestQuerySchema.safeParse({ role: url.searchParams.get('role') ?? undefined });
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }

  const actor = workReadActorFromIdentity(identity.user);
  const manifest = await getReaderAudioManifest(actor, partId, parsed.data.role);
  return jsonOk(manifest);
});
