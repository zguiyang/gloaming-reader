import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import { AdminLogsCenter } from './admin-logs-center';

function AdminLogsCenterFallback() {
  return (
    <div className="mx-auto max-w-6xl">
      <Skeleton className="h-11 w-56 rounded-xl bg-muted/70" />
      <Skeleton className="mt-8 h-40 w-full rounded-2xl bg-muted/70" />
    </div>
  );
}

export default function AdminLogsPage() {
  return (
    <Suspense fallback={<AdminLogsCenterFallback />}>
      <AdminLogsCenter />
    </Suspense>
  );
}
