'use client';

import { BookOpenIcon, RefreshCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { BookDetailRecommendations } from '@/features/book-detail/book-detail-recommendations';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

/** Content unavailable / load-failure state for live book detail. */
export function BookDetailUnavailable({ workId, message }: { workId?: string; message?: string }) {
  const router = useRouter();
  const { locale } = useLocale();

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col gap-12 md:gap-16',
      )}
    >
      <div className="flex flex-col items-center justify-center px-2 pt-8 text-center md:pt-16">
        <BookOpenIcon className="mb-6 size-20 text-muted-foreground/50 md:size-24" strokeWidth={1} aria-hidden />
        <h1 className="font-heading text-2xl font-semibold text-foreground md:text-[32px] md:leading-10">
          {t(locale, 'content.bookDetail.unavailableTitle')}
        </h1>
        <p className="mt-4 max-w-md text-base text-muted-foreground">
          {message?.trim() || t(locale, 'content.bookDetail.unavailableDefault')}
        </p>
        <div className="mt-8 flex w-full max-w-md flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center sm:gap-4">
          <Button
            type="button"
            className="h-11 rounded-xl px-8 text-sm shadow-sm hover:bg-brand-deep active:scale-[0.98]"
            onClick={() => router.refresh()}
          >
            <RefreshCwIcon className="size-4" strokeWidth={1.5} aria-hidden />
            {t(locale, 'content.bookDetail.reload')}
          </Button>
          <Button
            nativeButton={false}
            variant="outline"
            className="h-11 rounded-xl border-2 border-outline/60 px-8 text-sm text-muted-foreground hover:bg-surface-container-low"
            render={<Link href={AUTH_ROUTES.discover} />}
          >
            {t(locale, 'content.common.backToDiscover')}
          </Button>
        </div>
      </div>

      <BookDetailRecommendations excludeWorkId={workId} showDivider={false} />
    </div>
  );
}
