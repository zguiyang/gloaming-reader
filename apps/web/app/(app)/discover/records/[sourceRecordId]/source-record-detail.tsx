'use client';

import { useQuery } from '@tanstack/react-query';

import { t } from '@gloaming/i18n';
import { sourceRecordDetailSchema } from '@gloaming/shared/discovery';

import { Button } from '@/components/ui/button';
import { BookDetailPage } from '@/features/book-detail/book-detail-page';
import { DiscoverSourceCard, toDiscoverItem } from '@/features/discover';
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
        description: query.data.description,
        actions: <DiscoverSourceCard item={item} detailMode actionsOnly />,
      }}
    />
  );
}
