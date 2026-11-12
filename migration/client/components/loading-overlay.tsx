import type { ReactNode } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type LoadingOverlayProps = {
  active: boolean;
  label?: string;
  children: ReactNode;
  className?: string;
};

/** Area-scoped loading mask — centers spinner + optional label over `children`. */
export function LoadingOverlay({ active, label, children, className }: LoadingOverlayProps) {
  return (
    <div className={cn('relative', className)} aria-busy={active}>
      <div inert={active}>{children}</div>
      <div
        className={cn(
          'absolute inset-0 z-10 flex items-center justify-center',
          'bg-background/55 transition-opacity duration-300 ease-out-soft',
          active ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden={!active}
      >
        {active ? (
          <div className="flex flex-col items-center gap-2.5 px-4" role="status">
            <Spinner className="size-5 text-primary" aria-hidden />
            {label ? <p className="text-sm text-brand-deep">{label}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
