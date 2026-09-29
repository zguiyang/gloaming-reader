import { WorksEditPage } from '@/features/admin/works/works-edit-page';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminWorkEditPage({ params }: PageProps) {
  const { id } = await params;
  return <WorksEditPage key={id} workId={id} />;
}
