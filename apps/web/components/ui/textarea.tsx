import * as React from 'react';

import { controlFilledClasses, filledReadOnlyClasses } from '@/components/ui/control-appearance';
import { cn } from '@/lib/utils';

function Textarea({
  className,
  appearance = 'default',
  ...props
}: React.ComponentProps<'textarea'> & {
  /** Opt-in tonal filled styling; default keeps the existing outline look. */
  appearance?: 'default' | 'filled';
}) {
  return (
    <textarea
      data-slot="textarea"
      data-appearance={appearance}
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        appearance === 'filled' && controlFilledClasses,
        appearance === 'filled' && filledReadOnlyClasses,
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
