import { DiscoverRecordDetailPage } from '@/features/discover/discover-record-detail-page';

export default async function Page({ params }: { params: Promise<{ sourceRecordId: string }> }) {
  const { sourceRecordId } = await params;
  return <DiscoverRecordDetailPage sourceRecordId={sourceRecordId} />;
}
