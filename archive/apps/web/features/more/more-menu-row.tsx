import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type MoreMenuRowProps = {
  href: string;
  icon: ReactNode;
  label: string;
  className?: string;
};

export function MoreMenuRow({ href, icon, label, className }: MoreMenuRowProps) {
  return (
    <li className={cn('border-b border-border/50 last:border-b-0', className)}>
      <Link
        href={href}
        className={cn(
          'group flex min-h-14 items-center gap-3 px-1 py-2 transition-colors duration-200 ease-out-soft',
          'hover:text-primary',
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground group-hover:text-primary">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">
          {label}
        </span>
        <ChevronRightIcon
          className="size-5 shrink-0 text-muted-foreground/60 group-hover:text-primary/80"
          strokeWidth={1.5}
          aria-hidden
        />
      </Link>
    </li>
  );
}
