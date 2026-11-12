import type { ReactNode } from 'react';

/**
 * Reading Space — independent of AppShell.
 * No SiteNav, no MobileBottomNav; only ReaderChrome inside the feature.
 */
export default function ReaderGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
