import { RouteLoading } from '@/components/route-loading';

/** Soft pending state while immersive reader route segments resolve. */
export default function ReaderLoading() {
  return <RouteLoading className="min-h-dvh bg-background" />;
}
