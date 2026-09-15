import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type AccountSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function AccountSection({ title, description, children, className }: AccountSectionProps) {
  return (
    <section className={cn('border-b border-border/50 py-6 last:border-b-0', className)}>
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
