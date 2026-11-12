import { BookPageTurn } from '@/components/book-page-turn';
import { cn } from '@/lib/utils';

type RouteLoadingProps = {
  className?: string;
  /** Full-viewport overlay (shell session waits). Default: in-shell content area. */
  overlay?: boolean;
  label?: string;
};

/**
 * Shared pending UI for App / Admin route segments and shell waits.
 * Keeps chrome mounted for in-shell use; overlay mode covers the viewport softly.
 */
export function RouteLoading({ className, overlay = false, label }: RouteLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex flex-col items-center justify-center gap-5',
        overlay ? 'fixed inset-0 z-[60] bg-background/70 px-6 backdrop-blur-[1px]' : 'min-h-[42vh] px-6 py-16',
        className,
      )}
    >
      <BookPageTurn size="md" />
      {label ? (
        <p className="font-heading text-base tracking-tight text-foreground/80">{label}</p>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}
