'use client';

import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ADMIN_ROUTES } from '@/constants';
import { formatWorksApiError, useAdminWorkQuery } from '@/features/admin/works/works-api';
import { ReadingPartView } from '@/features/content';

type WorksPreviewPartPageProps = {
  workId: string;
  partId: string;
};

export function WorksPreviewPartPage({ workId, partId }: WorksPreviewPartPageProps) {
  const router = useRouter();
  const detailQuery = useAdminWorkQuery(workId);
  const work = detailQuery.data;

  if (detailQuery.isPending) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">加载章节中…</p>
      </div>
    );
  }

  if (detailQuery.isError || !work) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <FileText className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">无法加载作品：{formatWorksApiError(detailQuery.error)}</p>
        <Button type="button" variant="outline" onClick={() => void detailQuery.refetch()}>
          重试
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
        <p className="text-sm text-muted-foreground">该章节不存在。</p>
        <Button type="button" variant="outline" onClick={() => router.replace(ADMIN_ROUTES.workPreview(workId))}>
          返回目录
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* 常驻极简审查条：返回目录 + 章节位置 + 上一章/下一章 */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border/40 bg-background/90 px-4 backdrop-blur-md md:px-8">
        <Button
          type="button"
          variant="ghost"
          nativeButton={false}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          render={<Link href={ADMIN_ROUTES.workPreview(workId)} />}
        >
          <ArrowLeft data-icon="inline-start" className="size-4" />
          目录
        </Button>

        <p className="min-w-0 truncate text-sm text-muted-foreground">
          第 {currentIndex + 1} / {parts.length} 章
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
              上一章
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled className="text-muted-foreground/40">
              <ArrowLeft data-icon="inline-start" className="size-4" />
              上一章
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
              下一章
              <ArrowRight data-icon="inline-end" className="size-4" />
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled className="text-muted-foreground/40">
              下一章
              <ArrowRight data-icon="inline-end" className="size-4" />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pt-14">
        {/* Header already clears 56px; keep body top inset compact. */}
        <ReadingPartView html={current.body} className="pt-4 md:pt-6" />
      </div>
    </div>
  );
}
