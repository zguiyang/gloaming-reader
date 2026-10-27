'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';

import { t } from '@gloaming/i18n';
import { sourceRecordDetailSchema } from '@gloaming/shared/discovery';

import { Button } from '@/components/ui/button';
import { WorkDetailHeroLayout } from '@/components/work-detail-hero-layout';
import { toDiscoverItem } from '@/features/discover/discover-model';
import { DiscoverSourceCard } from '@/features/discover/discover-source-card';
import { WorkCover } from '@/features/work-cover';
import { apiRequest } from '@/lib/api-request';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';

export function DiscoverRecordDetailPage({ sourceRecordId }: { sourceRecordId: string }) {
  const { locale } = useLocale();
  const { data: session } = authClient.useSession();
  const query = useQuery({
    queryKey: ['discover', 'record', session?.user.id ?? null, sourceRecordId, locale],
    queryFn: ({ signal }) =>
      apiRequest(`/api/discover/records/${encodeURIComponent(sourceRecordId)}`, {
        schema: sourceRecordDetailSchema,
        signal,
      }),
  });
  return (
    <div className="flex w-full flex-col gap-8 md:gap-14">
      <Link
        href="/discover"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        {t(locale, 'content.discover.backToDiscover')}
      </Link>
      {query.isPending ? (
        <p role="status">{t(locale, 'common.loading')}</p>
      ) : query.isError ? (
        <div role="alert" className="space-y-3">
          <p>{t(locale, 'content.discover.loadFailed')}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t(locale, 'content.common.retry')}
          </Button>
        </div>
      ) : (
        <WorkDetailHeroLayout
          cover={
            <WorkCover
              title={query.data.title}
              coverImageUrl={query.data.coverUrl}
              className="aspect-[2/3] w-48 md:w-full md:max-w-[280px]"
            />
          }
        >
          <div className="space-y-2">
            <h1 className="font-heading text-3xl leading-tight font-bold tracking-tight text-foreground text-balance md:text-5xl md:leading-[1.15]">
              {toDiscoverItem(query.data).title}
            </h1>
            {toDiscoverItem(query.data).author ? (
              <p className="font-heading text-lg text-muted-foreground italic md:text-2xl md:leading-8">
                {toDiscoverItem(query.data).author}
              </p>
            ) : null}
          </div>
          <p className="font-reading mx-auto max-w-2xl whitespace-pre-line text-base leading-7 text-muted-foreground md:mx-0 md:text-lg md:leading-8 md:italic">
            {query.data.description?.trim() || t(locale, 'content.discover.descriptionEmpty')}
          </p>
          <div className="mx-auto max-w-xl md:mx-0">
            <DiscoverSourceCard item={toDiscoverItem(query.data)} detailMode actionsOnly />
          </div>
        </WorkDetailHeroLayout>
      )}
    </div>
  );
}
