'use client';

import { createContext, type ReactNode, useContext } from 'react';

import { GlobalLoading } from '@/components/global-loading';
import { MobileBottomNav, SiteNav } from '@/components/navigation';
import { authClient, type User } from '@/lib/auth';

/**
 * Thin adapter over Better Auth session for shell children.
 */
const AppUserContext = createContext<User | null>(null);

export function useAppUser() {
  return useContext(AppUserContext);
}

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { data, isPending } = authClient.useSession();
  const user = data?.user ?? null;

  if (isPending) {
    return <GlobalLoading />;
  }

  return (
    <AppUserContext.Provider value={user}>
      {/* --app-shell-bottom: tab bar + safe-area on mobile; 0 on md+ (see DESIGN.md). */}
      <div className="flex h-dvh flex-col overflow-hidden max-md:[--app-shell-bottom:calc(3.5rem+env(safe-area-inset-bottom,0px))] md:[--app-shell-bottom:0px]">
        <SiteNav />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="container py-6 pb-[calc(1.5rem+var(--app-shell-bottom,0px))] md:py-12 md:pb-12">
            {children}
          </div>
        </main>
        <MobileBottomNav />
      </div>
    </AppUserContext.Provider>
  );
}
