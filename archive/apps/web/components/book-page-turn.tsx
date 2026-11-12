import { cn } from '@/lib/utils';

type BookPageTurnProps = {
  className?: string;
  /** Visual scale of the open book. */
  size?: 'sm' | 'md';
};

/**
 * Editorial route-pending mark: an open book with one soft page turn.
 * Paper / brand tokens only — quiet motion, no glass or neon.
 */
export function BookPageTurn({ className, size = 'md' }: BookPageTurnProps) {
  const shell = size === 'md' ? 'h-[4.75rem] w-[7.25rem]' : 'h-14 w-[5.5rem]';
  const page = size === 'md' ? 'w-[3.35rem]' : 'w-[2.5rem]';

  return (
    <div className={cn('relative', shell, className)} aria-hidden>
      <span className="absolute inset-x-3 bottom-0.5 h-2 rounded-full bg-foreground/[0.07] blur-[3px]" />

      <div className="absolute inset-0 flex items-end justify-center [perspective:560px]">
        <div className="relative flex h-[90%] w-full items-stretch justify-center">
          <span className="absolute top-[5%] bottom-[3%] left-1/2 z-20 w-[2px] -translate-x-1/2 rounded-full bg-brand-deep/40" />

          {/* Left settled leaf — slight open angle */}
          <div
            className={cn(
              'relative z-10 h-full origin-right rounded-l-md rounded-r-sm bg-paper shadow-[inset_-6px_0_10px_-8px_rgb(0_0_0/0.12)] ring-1 ring-foreground/10',
              page,
            )}
            style={{ transform: 'rotateY(8deg)' }}
          >
            <PageLines align="left" />
            <span className="absolute inset-y-[8%] right-0 w-px bg-foreground/8" />
          </div>

          {/* Right stack under the turning leaf */}
          <div
            className={cn(
              'relative z-0 -ml-px h-full origin-left rounded-l-sm rounded-r-md bg-paper shadow-[inset_6px_0_10px_-8px_rgb(0_0_0/0.1)] ring-1 ring-foreground/10',
              page,
            )}
            style={{ transform: 'rotateY(-6deg)' }}
          >
            <PageLines align="right" />
            <span className="absolute inset-y-[8%] left-0 w-px bg-foreground/8" />
            {/* subtle stacked edge */}
            <span className="absolute top-[3%] right-[-3px] bottom-[3%] w-[3px] rounded-r-sm bg-brand-soft/70 ring-1 ring-foreground/5" />
          </div>

          {/* Turning leaf hinged at the spine */}
          <div
            className={cn(
              'absolute top-0 left-1/2 z-30 h-full origin-left rounded-l-sm rounded-r-md',
              'bg-paper ring-1 ring-foreground/12',
              'motion-safe:animate-book-page-turn',
              'motion-reduce:opacity-95',
              page,
            )}
            style={{ transformStyle: 'preserve-3d' }}
          >
            <div className="absolute inset-0 overflow-hidden rounded-[inherit] [backface-visibility:hidden]">
              <PageLines align="right" />
              <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-foreground/[0.05] to-transparent" />
            </div>
            <div
              className="absolute inset-0 overflow-hidden rounded-[inherit] bg-brand-soft [backface-visibility:hidden]"
              style={{ transform: 'rotateY(180deg)' }}
            >
              <span className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-foreground/[0.06] to-transparent" />
              <span className="absolute inset-y-[18%] left-[18%] right-[22%] h-px bg-brand-deep/25" />
              <span className="absolute inset-y-[30%] left-[18%] right-[30%] h-px bg-brand-deep/15" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PageLines({ align }: { align: 'left' | 'right' }) {
  const pad = align === 'left' ? 'pl-[20%] pr-[14%]' : 'pl-[14%] pr-[20%]';
  return (
    <div className={cn('flex h-full flex-col justify-center gap-[16%]', pad)}>
      <span className="h-px w-full bg-foreground/14" />
      <span className="h-px w-[88%] bg-foreground/11" />
      <span className="h-px w-[70%] bg-foreground/9" />
      <span className="h-px w-[78%] bg-foreground/8" />
    </div>
  );
}
