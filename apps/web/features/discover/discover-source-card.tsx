'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightIcon, BookmarkIcon, CheckIcon, Loader2Icon, RotateCcwIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { SourceRecordSaveResult, SourceRecordSaveStatus } from '@gloaming/shared/library';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import {
  discoverQueryKey,
  saveSourceRecordToLibrary,
  useSourceRecordSaveStatusQuery,
} from '@/features/discover/discover-api';
import { categoryDisplayName, type DiscoverItem } from '@/features/discover/discover-model';
import { WorkCover } from '@/features/work-cover';
import { isUnauthorizedError } from '@/lib/api-request';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { workDetailHref } from '@/lib/navigation/work-detail-return';
import { cn } from '@/lib/utils';

type DiscoverSourceCardProps = {
  item: DiscoverItem;
};

type SaveActionState = 'saving' | null;

/**
 * SourceRecord Discover card.
 *
 * Save feedback is driven by the server-side Save Intent status, not by the
 * linked `linkedWorkId`: materialization links the Work first and keeps
 * parsing, so only `ready` (readable Work + membership) may claim completion
 * or expose the Work entry. An unmaterialized SourceRecord has no readable Work
 * yet, so its action is an explicit Save Intent that materializes on demand.
 */
export function DiscoverSourceCard({ item }: DiscoverSourceCardProps) {
  const { data } = authClient.useSession();
  const userId = data?.user.id ?? null;
  return <DiscoverSourceCardContent key={userId ?? 'anonymous'} item={item} userId={userId} />;
}

function DiscoverSourceCardContent({ item, userId }: DiscoverSourceCardProps & { userId: string | null }) {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<SaveActionState>(null);
  const [posted, setPosted] = useState<{
    result: SourceRecordSaveResult;
    seenData: SourceRecordSaveStatus | undefined;
  } | null>(null);
  const statusQuery = useSourceRecordSaveStatusQuery(item.id);

  // A POST result only bridges until the status query reports data of its own:
  // once the query data object changes, the server read is authoritative again.
  const postedResult = posted && posted.seenData === statusQuery.data ? posted.result : null;
  const serverStatus = postedResult?.status ?? statusQuery.data?.status ?? null;

  // Refresh the records list once the server reports readiness so the shared
  // `linkedWorkId` projection catches up with the completed import.
  const wasReady = useRef(false);
  useEffect(() => {
    if (serverStatus === 'ready' && !wasReady.current) {
      wasReady.current = true;
      void queryClient.invalidateQueries({ queryKey: [...discoverQueryKey.all, 'records'] });
    }
    if (serverStatus !== 'ready') {
      wasReady.current = false;
    }
  }, [queryClient, serverStatus]);

  async function handleSaveIntent() {
    if (action) {
      return;
    }
    setAction('saving');
    try {
      const result = await saveSourceRecordToLibrary(item.id);
      // An older GET (for example, the pre-save `none` read) must not overwrite
      // this POST result and stop polling after the import has been queued.
      await queryClient.cancelQueries({ queryKey: discoverQueryKey.saveStatus(item.id, userId), exact: true });
      queryClient.setQueryData(discoverQueryKey.saveStatus(item.id, userId), {
        status: result.status,
        workId: result.workId,
        failureReason: null,
      });
      setPosted({ result, seenData: statusQuery.data });
      void queryClient.invalidateQueries({ queryKey: [...discoverQueryKey.all, 'records'] });
      if (result.status === 'ready') {
        toast.success(t(locale, 'content.discover.saveReady'));
      } else {
        toast.info(t(locale, 'content.discover.savePending'));
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        openLogin();
        return;
      }
      toast.error(t(locale, 'content.discover.saveFailed'));
    } finally {
      setAction(null);
    }
  }

  const isSaving = action === 'saving';
  const isPreparing = !isSaving && serverStatus === 'pending';
  const isFailed = !isSaving && serverStatus === 'failed';
  const isSaved = !isSaving && serverStatus === 'ready';

  // The Work entry is only truthful when the server says the import is ready;
  // for viewers without a saved intent the existing linked projection applies,
  // while pending/failed imports never expose a detail entry of their own.
  const entryWorkId = isSaved
    ? (postedResult?.workId ?? statusQuery.data?.workId ?? item.linkedWorkId)
    : item.linkedWorkId;
  const detailHref =
    !isPreparing && !isFailed && !isSaving && entryWorkId ? workDetailHref(entryWorkId, AUTH_ROUTES.discover) : null;
  const failureReason = isFailed ? (statusQuery.data?.failureReason ?? null) : null;

  const cover = <WorkCover title={item.title} coverImageUrl={item.coverImageUrl} className="aspect-[2/3] rounded-sm" />;

  return (
    <article className="flex flex-col gap-3">
      {detailHref ? (
        <Link
          href={detailHref}
          className={cn(
            'relative outline-none',
            'transition-transform duration-300 ease-out-soft',
            'hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
          aria-label={t(locale, 'content.common.viewBookDetailAria', { title: item.title })}
        >
          {cover}
        </Link>
      ) : (
        cover
      )}

      <div className="flex min-w-0 flex-col">
        <h3
          className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground md:text-base"
          title={item.title}
        >
          {detailHref ? (
            <Link
              href={detailHref}
              className="transition-colors duration-300 ease-out-soft hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {item.title}
            </Link>
          ) : (
            item.title
          )}
        </h3>
        {item.author ? (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground md:text-[13px]">{item.author}</p>
        ) : null}

        {item.categories.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t(locale, 'content.discover.categoriesAria')}>
            {item.categories.map((category) => (
              <li key={category.id}>
                <Badge variant="secondary" className="rounded-full bg-accent font-normal text-accent-foreground">
                  {categoryDisplayName(category)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3">
          {isSaving ? (
            <Button type="button" variant="outline" disabled className="h-8 gap-1.5">
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              {t(locale, 'content.discover.addToLibrary')}
            </Button>
          ) : isPreparing ? (
            <Button type="button" variant="outline" disabled className="h-8 gap-1.5">
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              {t(locale, 'content.discover.preparing')}
            </Button>
          ) : isFailed ? (
            <div className="flex flex-col items-start gap-1">
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => {
                  void handleSaveIntent();
                }}
              >
                <RotateCcwIcon className="size-4" strokeWidth={1.5} aria-hidden />
                {t(locale, 'content.common.retry')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {failureReason ?? t(locale, 'content.discover.saveFailed')}
              </p>
            </div>
          ) : isSaved ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled
                className="h-8 cursor-default gap-1.5 bg-surface-container-high text-muted-foreground shadow-none disabled:opacity-100"
              >
                <CheckIcon className="size-4" strokeWidth={1.5} aria-hidden />
                {t(locale, 'content.discover.inLibrary')}
              </Button>
              {detailHref ? (
                <Button
                  nativeButton={false}
                  variant="outline"
                  className="h-8 gap-1.5"
                  render={<Link href={detailHref} />}
                >
                  {t(locale, 'content.discover.viewDetail')}
                  <ArrowRightIcon className="size-4" strokeWidth={1.5} aria-hidden />
                </Button>
              ) : null}
              <Button
                nativeButton={false}
                variant="link"
                className="h-8 px-0"
                render={<Link href={AUTH_ROUTES.library} />}
              >
                {t(locale, 'content.discover.goToLibrary')}
              </Button>
            </div>
          ) : detailHref ? (
            <Button nativeButton={false} variant="outline" className="h-8 gap-1.5" render={<Link href={detailHref} />}>
              {t(locale, 'content.discover.viewDetail')}
              <ArrowRightIcon className="size-4" strokeWidth={1.5} aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => {
                void handleSaveIntent();
              }}
            >
              <BookmarkIcon className="size-4" strokeWidth={1.5} aria-hidden />
              {t(locale, 'content.discover.addToLibrary')}
            </Button>
          )}
          {!detailHref && isPreparing ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{t(locale, 'content.discover.preparingHint')}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
