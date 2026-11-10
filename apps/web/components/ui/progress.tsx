'use client';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '@/lib/utils';

/** shadcn Base UI progress composition with configurable track and indicator. */
function Progress({
  className,
  indicatorClassName,
  ...props
}: ProgressPrimitive.Root.Props & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn('w-full', className)} {...props}>
      <ProgressPrimitive.Track data-slot="progress-track" className="h-full w-full overflow-hidden rounded-[inherit]">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn('h-full bg-primary transition-[width]', indicatorClassName)}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
