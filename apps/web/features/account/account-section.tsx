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
    <section
      className={cn(
        'rounded-xl bg-surface-container-low px-5 py-6 ring-1 ring-foreground/8 md:px-6 md:py-7',
        className,
      )}
    >
      <header className="mb-5 md:mb-6">
        <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h2>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
