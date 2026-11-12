import { DiscoverRecordDetailPage } from './source-record-detail';

export default async function Page({ params }: { params: Promise<{ sourceRecordId: string }> }) {
  const { sourceRecordId } = await params;
  return <DiscoverRecordDetailPage sourceRecordId={sourceRecordId} />;
}
