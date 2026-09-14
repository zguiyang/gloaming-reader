'use client';

import { ArrowLeftIcon, HeadphonesIcon, LanguagesIcon, MenuIcon, SparklesIcon, TypeIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import type { ReaderFontSize } from '@/features/reader/reader-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type ReaderChromeProps = {
  visible: boolean;
  workTitle: string;
  partTitle: string;
  chapterLabel: string | null;
  progressRatio: number;
  fontSize: ReaderFontSize;
  aiOpen: boolean;
  tocOpen: boolean;
  isListening: boolean;
  isBilingual: boolean;
  isBilingualLoading?: boolean;
  onToggleToc: () => void;
  onToggleFontSize: () => void;
  onToggleAi: () => void;
  onToggleTts: () => void;
  onToggleBilingual: () => void;
};

function navigateReaderBack(router: ReturnType<typeof useRouter>) {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back();
    return;
  }
  router.replace(AUTH_ROUTES.discover);
}

export function ReaderChrome({
  visible,
  workTitle,
  partTitle,
  chapterLabel,
  progressRatio,
  fontSize,
  aiOpen,
  tocOpen,
  isListening,
  isBilingual,
  isBilingualLoading = false,
  onToggleToc,
  onToggleFontSize,
  onToggleAi,
  onToggleTts,
  onToggleBilingual,
}: ReaderChromeProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const fill = Math.min(100, Math.max(0, Math.round(progressRatio)));

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 border-b border-border/40 bg-background/90 backdrop-blur-md transition-all duration-300 ease-out-soft',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2 px-3 md:gap-3 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t(locale, 'content.reader.chrome.back')}
            onClick={() => navigateReaderBack(router)}
          >
            <ArrowLeftIcon className="size-5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('size-10 shrink-0 text-muted-foreground hover:text-foreground', tocOpen && 'text-primary')}
            aria-label={t(locale, 'content.reader.chrome.toc')}
            aria-pressed={tocOpen}
            onClick={onToggleToc}
          >
            <MenuIcon className="size-5" strokeWidth={1.5} />
          </Button>
          <div className="min-w-0">
            <p className="hidden truncate font-heading text-sm text-foreground md:block">{workTitle}</p>
            <p className="truncate font-heading text-sm text-foreground md:hidden">{partTitle}</p>
            <p className="hidden truncate text-xs text-muted-foreground md:block">{partTitle}</p>
          </div>
        </div>

        {chapterLabel ? (
          <p className="hidden shrink-0 text-xs tabular-nums text-muted-foreground md:block">{chapterLabel}</p>
        ) : null}

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'size-10 text-muted-foreground hover:text-foreground',
              isBilingual && 'bg-accent text-brand-deep',
            )}
            aria-label={t(locale, 'content.reader.chrome.bilingual')}
            aria-pressed={isBilingual}
            disabled={isBilingualLoading}
            onClick={onToggleBilingual}
          >
            <LanguagesIcon className="size-5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 text-muted-foreground hover:text-foreground"
            aria-label={t(locale, 'content.reader.chrome.fontSize', { size: fontSize })}
            onClick={onToggleFontSize}
          >
            <TypeIcon className="size-5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('size-10 text-muted-foreground hover:text-foreground', aiOpen && 'bg-accent text-brand-deep')}
            aria-label={t(locale, 'content.reader.chrome.aiAssist')}
            aria-pressed={aiOpen}
            onClick={onToggleAi}
          >
            <SparklesIcon className="size-5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'size-10 text-muted-foreground hover:text-foreground',
              isListening && 'bg-accent text-brand-deep',
            )}
            aria-label={t(locale, 'content.reader.chrome.listenRead')}
            aria-pressed={isListening}
            onClick={onToggleTts}
          >
            <HeadphonesIcon className="size-5" strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <div className="h-1 w-full bg-surface-container-highest/80" aria-hidden>
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-out-soft"
          style={{ width: `${fill}%` }}
        />
      </div>
    </header>
  );
}
