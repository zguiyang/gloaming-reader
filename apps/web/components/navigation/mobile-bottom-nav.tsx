'use client';

import { BookMarkedIcon, CompassIcon, HistoryIcon, MoreHorizontalIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';

import {
  getNavCopy,
  getPrimaryNavLink,
  matchesNavPath,
  MOBILE_PRIMARY_TAB_IDS,
  type PrimaryNavId,
} from '@/components/navigation/nav-config';
import { AUTH_ROUTES } from '@/constants';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const TAB_ICONS: Record<PrimaryNavId, ReactNode> = {
  shelf: <BookMarkedIcon className="size-5" strokeWidth={1.5} aria-hidden />,
  discover: <CompassIcon className="size-5" strokeWidth={1.5} aria-hidden />,
  history: <HistoryIcon className="size-5" strokeWidth={1.5} aria-hidden />,
};

/**
 * Learner mobile bottom tabs. AppShell only — never on Reader / Admin / Landing.
 */
export function MobileBottomNav() {
  const pathname = usePathname() ?? '/';
  const { locale } = useLocale();
  const navCopy = useMemo(() => getNavCopy(locale), [locale]);
  const isMoreActive = matchesNavPath(pathname, AUTH_ROUTES.more);

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-md md:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
      aria-label={navCopy.mainNav}
    >
      <div className="mx-auto grid h-14 max-w-lg grid-cols-4">
        {MOBILE_PRIMARY_TAB_IDS.map((id) => {
          const item = getPrimaryNavLink(id, locale);
          const isActive = matchesNavPath(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-200 ease-out-soft',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {TAB_ICONS[item.id]}
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
        <Link
          href={AUTH_ROUTES.more}
          aria-current={isMoreActive ? 'page' : undefined}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-200 ease-out-soft',
            isMoreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <MoreHorizontalIcon className="size-5" strokeWidth={1.5} aria-hidden />
          <span>{navCopy.more}</span>
        </Link>
      </div>
    </nav>
  );
}
