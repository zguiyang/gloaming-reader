import { Suspense } from 'react';

import { ReaderPage } from '@/features/reader/reader-page';

type PageProps = {
  params: Promise<{ workId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { workId } = await params;
  return (
    <Suspense fallback={null}>
      <ReaderPage key={workId} workId={workId} />
    </Suspense>
  );
}
