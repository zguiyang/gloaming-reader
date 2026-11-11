import { RouteLoading } from '@/components/route-loading';

/**
 * In-shell route pending state for AppShell pages.
 * SiteNav / bottom tabs stay mounted — no full-viewport white flash.
 */
export default function AppLoading() {
  return <RouteLoading />;
}
