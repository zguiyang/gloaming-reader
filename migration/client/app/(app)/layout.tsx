import type { ReactNode } from 'react';

import { AppShell } from '@/features/app-shell/app-shell';

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
