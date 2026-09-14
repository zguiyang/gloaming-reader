'use client';

import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { ADMIN_ROUTES } from '@/constants';
import { formatWorksApiError, useAdminWorkQuery } from '@/features/admin/works/works-api';
import { ReadingPartView } from '@/features/content';
import { useLocale } from '@/lib/locale-context';

type WorksPreviewPartPageProps = {
  workId: string;
  partId: string;
};

export function WorksPreviewPartPage({ workId, partId }: WorksPreviewPartPageProps) {
  const { locale } = useLocale();
  const router = useRouter();
  const detailQuery = useAdminWorkQuery(workId);
  const work = detailQuery.data;

  if (detailQuery.isPending) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">{t(locale, 'admin.works.preview.loadingPart')}</p>
      </div>
    );
  }

  if (detailQuery.isError || !work) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <FileText className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t(locale, 'admin.works.preview.loadFailed', { error: formatWorksApiError(detailQuery.error) })}
        </p>
        <Button type="button" variant="outline" onClick={() => void detailQuery.refetch()}>
          {t(locale, 'content.common.retry')}
        </Button>
      </div>
    );
  }

  const parts = work.parts;
  const currentIndex = Math.max(
    0,
    parts.findIndex((part) => part.id === partId),
  );
  const current = parts[currentIndex];
  const prev = currentIndex > 0 ? parts[currentIndex - 1] : null;
  const next = currentIndex < parts.length - 1 ? parts[currentIndex + 1] : null;

  if (!current) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <FileText className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t(locale, 'admin.works.preview.partNotFound')}</p>
        <Button type="button" variant="outline" onClick={() => router.replace(ADMIN_ROUTES.workPreview(workId))}>
          {t(locale, 'admin.works.preview.backToToc')}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border/40 bg-background/90 px-4 backdrop-blur-md md:px-8">
        <Button
          type="button"
          variant="ghost"
          nativeButton={false}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          render={<Link href={ADMIN_ROUTES.workPreview(workId)} />}
        >
          <ArrowLeft data-icon="inline-start" className="size-4" />
          {t(locale, 'admin.works.preview.toc')}
        </Button>

        <p className="min-w-0 truncate text-sm text-muted-foreground">
          {t(locale, 'admin.works.preview.chapterPosition', { current: currentIndex + 1, total: parts.length })}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          {prev ? (
            <Button
              type="button"
              variant="ghost"
              nativeButton={false}
              className="text-muted-foreground hover:text-foreground"
              render={<Link href={ADMIN_ROUTES.workPreviewPart(workId, prev.id)} />}
            >
              <ArrowLeft data-icon="inline-start" className="size-4" />
              {t(locale, 'admin.works.preview.prevChapter')}
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled className="text-muted-foreground/40">
              <ArrowLeft data-icon="inline-start" className="size-4" />
              {t(locale, 'admin.works.preview.prevChapter')}
            </Button>
          )}
          {next ? (
            <Button
              type="button"
              variant="ghost"
              nativeButton={false}
              className="text-muted-foreground hover:text-foreground"
              render={<Link href={ADMIN_ROUTES.workPreviewPart(workId, next.id)} />}
            >
              {t(locale, 'admin.works.preview.nextChapter')}
              <ArrowRight data-icon="inline-end" className="size-4" />
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled className="text-muted-foreground/40">
              {t(locale, 'admin.works.preview.nextChapter')}
              <ArrowRight data-icon="inline-end" className="size-4" />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pt-14">
        <ReadingPartView html={current.body} className="pt-4 md:pt-6" />
      </div>
    </div>
  );
}
