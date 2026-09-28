import { WorksPreviewPartPage } from '@/features/admin/works/works-preview-part-page';

type PageProps = {
  params: Promise<{ id: string; partId: string }>;
};

export default async function AdminWorkPreviewPartPage({ params }: PageProps) {
  const { id, partId } = await params;
  return <WorksPreviewPartPage key={`${id}:${partId}`} workId={id} partId={partId} />;
}
