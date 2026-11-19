'use client';

import { t } from '@/i18n';

import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type ReaderChromeHintProps = {
  visible: boolean;
  onDismiss: () => void;
};

export function ReaderChromeHint({ visible, onDismiss }: ReaderChromeHintProps) {
  const { locale } = useLocale();

  return (
    <div
      className={cn(
        // Above the hidden reader chrome (z-40) so the tip is not covered.
        'pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[55] flex justify-center px-4 transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden={!visible}
    >
      <button
        type="button"
        className={cn(
          'pointer-events-auto rounded-full border border-border/50 bg-background/95 px-4 py-2 text-center text-sm text-muted-foreground shadow-card backdrop-blur-sm',
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300',
          !visible && 'pointer-events-none',
        )}
        onClick={onDismiss}
      >
        {t(locale, 'content.reader.chrome.tapToShowTools')}
      </button>
    </div>
  );
}
