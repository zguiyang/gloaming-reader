import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type FieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
  className?: string;
  labelAside?: ReactNode;
  /** Compact layout for the embedded authentication dialog. */
  hideLabel?: boolean;
};

export function Field({ label, htmlFor, error, children, className, labelAside, hideLabel }: FieldProps) {
  if (hideLabel) {
    return (
      <div className={className}>
        <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-foreground">
          {label}
        </label>
        {children}
        {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        {labelAside}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export const authInputClassName =
  'flex h-11 w-full rounded-md border border-border/70 bg-background px-3.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-200 ease-out-soft placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15 disabled:opacity-50';

export const authPrimaryButtonClassName =
  'h-11 w-full rounded-md text-sm font-medium duration-200 ease-out-soft hover:bg-brand-deep active:scale-[0.99]';

/** Dialog auth: field stack + action block rhythm (8px grid). */
export const authDialogFieldStackClassName = 'flex flex-col gap-3.5';
export const authDialogFormClassName = 'flex flex-col gap-5';
export const authDialogActionStackClassName = 'flex flex-col items-center gap-3.5 pt-0.5';
export const authDialogSectionClassName = 'flex flex-col gap-5';

export const authSocialButtonClassName =
  'relative flex h-11 w-full items-center rounded-md border border-border/70 bg-card px-3.5 text-sm font-medium text-foreground transition-colors duration-200 ease-out-soft hover:bg-muted/50 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15 active:scale-[0.99]';
