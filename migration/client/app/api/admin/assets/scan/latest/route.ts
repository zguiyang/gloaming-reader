import * as assetScanService from '@/server/domains/assets/scan/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const report = await assetScanService.getLatestScanReport();
    return jsonOk(report);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
