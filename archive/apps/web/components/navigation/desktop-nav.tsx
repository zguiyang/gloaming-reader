'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { getPrimaryNavLinks, matchesNavPath } from '@/components/navigation/nav-config';
import { useLocale } from '@/lib/locale-context';

export function DesktopNav() {
  const pathname = usePathname() ?? '/';
  const { locale } = useLocale();
  const primaryNavLinks = useMemo(() => getPrimaryNavLinks(locale), [locale]);

  return (
    <div className="flex items-center gap-8">
      {primaryNavLinks.map((item) => {
        const isActive = matchesNavPath(pathname, item.href);
        return (
          <Link key={item.id} href={item.href} aria-current={isActive ? 'page' : undefined} className="site-nav-link">
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
