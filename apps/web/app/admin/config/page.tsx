import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import { AdminConfigCenter } from './admin-config-center';

function AdminConfigCenterFallback() {
  return (
    <div className="mx-auto max-w-6xl">
      <Skeleton className="h-11 w-72 rounded-xl bg-muted/70" />
      <Skeleton className="mt-8 h-40 w-full rounded-2xl bg-muted/70" />
    </div>
  );
}

export default function AdminConfigPage() {
  return (
    <Suspense fallback={<AdminConfigCenterFallback />}>
      <AdminConfigCenter />
    </Suspense>
  );
}
