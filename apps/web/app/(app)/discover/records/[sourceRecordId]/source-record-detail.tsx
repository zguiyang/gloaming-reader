'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { t } from '@gloaming/i18n';
import { type SourceRecordDetail, sourceRecordDetailSchema, type SourceRecordItem } from '@gloaming/shared/discovery';

import { Button } from '@/components/ui/button';
import { chaptersFromParts } from '@/features/book-detail/book-detail-api';
import { BookDetailPage } from '@/features/book-detail/book-detail-page';
import { BookDetailToc } from '@/features/book-detail/book-detail-toc';
import { DiscoverSourceCard, fetchDiscoverRecords, toDiscoverItem } from '@/features/discover';
import { getWorkParts } from '@/features/reader/reader-parts-public';
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
  if (query.isPending) return <p role="status">{t(locale, 'common.loading')}</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>{t(locale, 'content.discover.loadFailed')}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t(locale, 'content.common.retry')}
        </Button>
      </div>
    );
  const item = toDiscoverItem(query.data);
  return (
    <BookDetailPage
      returnTo="/discover"
      source={{
        title: item.title,
        author: item.author,
        coverImageUrl: item.coverImageUrl,
        description: query.data.sourceMeta.summary ?? null,
        notes: query.data.sourceMeta.notes ?? (query.data.description ? [query.data.description] : []),
        categories: query.data.categories?.map((category) => category.name),
        actions: <DiscoverSourceCard item={item} detailMode actionsOnly />,
        children: <SourceDetailExtras record={query.data} userId={session?.user.id ?? null} />,
      }}
    />
  );
}

function SourceDetailExtras({ record, userId }: { record: SourceRecordDetail; userId: string | null }) {
  const { locale } = useLocale();
  const author = record.authors.find((entry) => entry.name.trim())?.name.trim() ?? '';
  const category = record.categories?.[0];
  const authorQuery = useQuery({
    queryKey: ['discover', 'related-author', userId, record.sourceRecordId, author],
    queryFn: ({ signal }) => fetchDiscoverRecords({ q: author, pageSize: 30 }, { signal }),
    enabled: Boolean(author),
  });
  const categoryQuery = useQuery({
    queryKey: ['discover', 'related-category', userId, record.sourceRecordId, category?.id],
    queryFn: ({ signal }) => fetchDiscoverRecords({ categoryId: category?.id, pageSize: 30 }, { signal }),
    enabled: Boolean(category?.id),
  });
  const partsQuery = useQuery({
    queryKey: ['discover', 'source-parts', userId, record.linkedWorkId],
    queryFn: ({ signal }) => getWorkParts(record.linkedWorkId!, { signal }),
    enabled: record.detailAvailable && Boolean(record.linkedWorkId),
    retry: false,
  });
  const normalizedAuthor = author.toLocaleLowerCase();
  const sameAuthor = (authorQuery.data?.items ?? [])
    .filter((candidate) => candidate.sourceRecordId !== record.sourceRecordId && candidate.sourceId === record.sourceId)
    .filter((candidate) =>
      candidate.authors.some((entry) => entry.name.trim().toLocaleLowerCase() === normalizedAuthor),
    )
    .slice(0, 4);
  const authorIds = new Set(sameAuthor.map((candidate) => candidate.sourceRecordId));
  const sameCategory = (categoryQuery.data?.items ?? [])
    .filter(
      (candidate) => candidate.sourceRecordId !== record.sourceRecordId && !authorIds.has(candidate.sourceRecordId),
    )
    .slice(0, 4);
  const chapters = chaptersFromParts(partsQuery.data?.parts ?? [], null);

  return (
    <div className="flex flex-col gap-8 md:gap-14">
      {record.linkedWorkId && chapters.length > 0 ? (
        <BookDetailToc book={{ id: record.linkedWorkId, chapters }} />
      ) : null}
      <SourceRelated title={t(locale, 'content.bookDetail.sameAuthor')} records={sameAuthor} />
      <SourceRelated title={t(locale, 'content.bookDetail.sameCategory')} records={sameCategory} />
    </div>
  );
}

function SourceRelated({ title, records }: { title: string; records: SourceRecordItem[] }) {
  if (records.length === 0) return null;
  return (
    <section className="space-y-5 border-t border-border/50 pt-8">
      <h2 className="font-heading text-xl font-semibold md:text-2xl">{title}</h2>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-6 md:overflow-visible md:px-0">
        {records.map((record) => {
          const item = toDiscoverItem(record);
          return (
            <Link
              key={item.id}
              href={`/discover/records/${encodeURIComponent(item.id)}`}
              className="group w-32 shrink-0 md:w-auto"
            >
              <WorkCover
                title={item.title}
                coverImageUrl={item.coverImageUrl}
                className="aspect-[2/3] w-full rounded-lg"
              />
              <h3 className="font-heading mt-3 line-clamp-2 text-sm font-semibold group-hover:text-primary md:text-base">
                {item.title}
              </h3>
              {item.author ? <p className="mt-1 text-xs text-muted-foreground">{item.author}</p> : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
