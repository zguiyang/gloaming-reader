'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { t } from '@/i18n';
import { type SourceRecordDetail, sourceRecordDetailSchema } from '@/shared/discovery';

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
        actions: <DiscoverSourceCard item={item} detailMode actionsOnly />,
        children: <SourceDetailExtras record={query.data} userId={session?.user.id ?? null} />,
      }}
    />
  );
}

function SourceDetailExtras({ record, userId }: { record: SourceRecordDetail; userId: string | null }) {
  const { locale } = useLocale();
  const author = record.authors.find((entry) => entry.name.trim())?.name.trim() ?? '';
  const authorQuery = useQuery({
    queryKey: ['discover', 'related-author', userId, record.externalId, author],
    queryFn: ({ signal }) => fetchDiscoverRecords({ q: author, pageSize: 30 }, { signal }),
    enabled: Boolean(author),
  });
  const partsQuery = useQuery({
    queryKey: ['discover', 'source-parts', userId, record.linkedWorkId],
    queryFn: ({ signal }) => getWorkParts(record.linkedWorkId!, { signal }),
    enabled: record.detailAvailable && Boolean(record.linkedWorkId),
    retry: false,
  });
  const normalizedAuthor = author.toLocaleLowerCase();
  const sameAuthor = (authorQuery.data?.items ?? [])
    .filter((candidate) => candidate.externalId !== record.externalId)
    .filter((candidate) =>
      candidate.authors.some((entry) => entry.name.trim().toLocaleLowerCase() === normalizedAuthor),
    )
    .slice(0, 4);
  const chapters = chaptersFromParts(partsQuery.data?.parts ?? [], null);

  return (
    <div className="flex flex-col gap-8 md:gap-14">
      {record.linkedWorkId && chapters.length > 0 ? (
        <BookDetailToc book={{ id: record.linkedWorkId, chapters }} />
      ) : null}
      <SourceRelated title={t(locale, 'content.bookDetail.sameAuthor')} records={sameAuthor} />
    </div>
  );
}

function SourceRelated({
  title,
  records,
}: {
  title: string;
  records: Array<{
    sourceRecordId: string | null;
    externalId: string;
    title: string;
    coverUrl: string | null;
  }>;
}) {
  if (records.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">{title}</h2>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {records.map((record) => {
          const hrefId = record.sourceRecordId ?? record.externalId;
          return (
            <li key={hrefId}>
              <Link href={`/discover/records/${encodeURIComponent(hrefId)}`} className="flex flex-col gap-2">
                <WorkCover title={record.title} coverImageUrl={record.coverUrl} className="aspect-[2/3] rounded-sm" />
                <span className="line-clamp-2 text-sm">{record.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
