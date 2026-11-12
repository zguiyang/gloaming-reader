import { listDiscoveryFacets } from '@/server/domains/discovery/read-model';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sourceKey = url.searchParams.get('sourceKey')?.trim() || undefined;
    const data = await listDiscoveryFacets(sourceKey);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
