'use client';

import { useMemo, useState } from 'react';

import { BrandMark } from '@/components/brand-mark';
import { AccountMenu, useNavAccount } from '@/components/navigation/account-menu';
import { DesktopNav } from '@/components/navigation/desktop-nav';
import { getNavCopy } from '@/components/navigation/nav-config';
import { ThemeModeNavButton } from '@/components/navigation/theme-mode-control';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthDialog } from '@/features/auth';
import { useLocale } from '@/lib/locale-context';

/**
 * Top site chrome for Landing + AppShell.
 * Desktop: primary links in-header. Mobile (App): Brand + Avatar only — tabs live in MobileBottomNav.
 */
export function SiteNav() {
  const { locale } = useLocale();
  const navCopy = useMemo(() => getNavCopy(locale), [locale]);
  const { user, isPending, username, email, initial, image, isAdmin, signOut } = useNavAccount();
  const { openLogin } = useAuthDialog();
  const [isAccountOpen, setIsAccountOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-sm">
      <nav className="container flex h-16 items-center justify-between gap-6 md:h-20" aria-label={navCopy.siteHeader}>
        <div className="flex min-w-0 items-center gap-8">
          <BrandMark href="/" name={navCopy.wordmark} appearance="editorial" size="md" className="shrink-0" />
          <div className="hidden md:block">
            {isPending ? <Skeleton className="h-6 w-80 rounded-md" /> : <DesktopNav />}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {isPending ? (
            <Skeleton className="size-9 rounded-full" />
          ) : user ? (
            <>
              <ThemeModeNavButton />
              <AccountMenu
                username={username}
                email={email}
                initial={initial}
                image={image}
                isAdmin={isAdmin}
                open={isAccountOpen}
                onOpenChange={setIsAccountOpen}
                onSignOut={signOut}
              />
            </>
          ) : (
            <button
              type="button"
              className="text-base font-medium text-primary transition-opacity duration-200 ease-out-soft hover:opacity-80"
              onClick={() => openLogin()}
            >
              {navCopy.signIn}
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
