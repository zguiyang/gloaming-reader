import { WorksPreviewPage } from '@/features/admin/works/works-preview-page';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminWorkPreviewPage({ params }: PageProps) {
  const { id } = await params;
  return <WorksPreviewPage key={id} workId={id} />;
}
