'use client';

import { t } from '@gloaming/i18n';

import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type GlobalLoadingProps = {
  /** When set, shows a custom loading line. */
  label?: string;
  className?: string;
};

/** Full-viewport overlay — route `loading.tsx` and shell session waits. */
export function GlobalLoading({ label, className }: GlobalLoadingProps) {
  const { locale } = useLocale();
  const loadingLabel = label ?? t(locale, 'common.loading');

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center bg-background/55 px-6 backdrop-blur-[2px]',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative flex size-16 items-center justify-center" aria-hidden>
          <span className="absolute size-14 rounded-full bg-brand-soft/70 motion-safe:animate-loading-soft-ring" />
          <span className="absolute size-9 rounded-full bg-paper/90 ring-1 ring-foreground/5" />
          <span className="relative flex items-end gap-1.5 pb-0.5">
            <span className="h-3 w-1 origin-bottom rounded-full bg-primary/80 motion-safe:animate-loading-page" />
            <span className="h-4 w-1 origin-bottom rounded-full bg-primary motion-safe:animate-loading-page [animation-delay:120ms]" />
            <span className="h-3.5 w-1 origin-bottom rounded-full bg-brand-deep/70 motion-safe:animate-loading-page [animation-delay:240ms]" />
          </span>
        </div>

        <div className="flex min-h-12 flex-col items-center text-center">
          <p className="font-heading text-lg tracking-tight text-foreground">{loadingLabel}</p>
        </div>
      </div>
    </div>
  );
}
