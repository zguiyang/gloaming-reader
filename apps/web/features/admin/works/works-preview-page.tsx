'use client';

import { BookOpen, FileText, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_ROUTES } from '@/constants';
import { formatWorksApiError, useAdminWorkQuery } from '@/features/admin/works/works-api';
import type { AdminWorkView } from '@/features/works-http';

function Cover({ work }: { work: AdminWorkView }) {
  if (work.coverAssetId) {
    return (
      <img
        src={`/api/assets/${work.coverAssetId}`}
        alt={`${work.title} 封面`}
        className="h-56 w-40 rounded-lg border border-border bg-surface-container-high object-cover shadow-[0_4px_20px_rgba(30,27,25,0.08)] md:h-64 md:w-44"
      />
    );
  }
  return (
    <div className="flex h-56 w-40 items-center justify-center rounded-lg border border-border bg-surface-container-high md:h-64 md:w-44">
      <span className="font-heading text-4xl font-semibold tracking-tight text-foreground/40">
        {work.title.trim().charAt(0).toUpperCase() || <BookOpen className="size-8" />}
      </span>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-14">
      <div className="flex gap-8">
        <Skeleton className="h-64 w-44 rounded-lg bg-muted/70" />
        <div className="flex flex-col justify-center gap-3">
          <Skeleton className="h-8 w-56 bg-muted/70" />
          <Skeleton className="h-4 w-32 bg-muted/70" />
          <Skeleton className="h-4 w-24 bg-muted/70" />
        </div>
      </div>
      <div className="mt-12 w-full space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-xl bg-muted/70" />
        ))}
      </div>
    </div>
  );
}

export function WorksPreviewPage({ workId }: { workId: string }) {
  const detailQuery = useAdminWorkQuery(workId);

  if (detailQuery.isPending) {
    return <PreviewSkeleton />;
  }

  if (detailQuery.isError && !detailQuery.data) {
    return (
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card px-6 py-14 text-center">
        <FileText className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">无法加载作品：{formatWorksApiError(detailQuery.error)}</p>
        <Button type="button" variant="outline" className="mt-5" onClick={() => void detailQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  const work = detailQuery.data;
  if (!work) return null;

  const isEpub = work.originKind === 'admin_epub';
  const parts = work.parts;
  const hasParts = parts.length > 0;

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto w-full max-w-3xl">
      <div className="mb-10 flex items-center justify-between gap-4">
        <Button
          type="button"
          variant="ghost"
          nativeButton={false}
          render={<Link href={ADMIN_ROUTES.workDetail(work.id)} />}
        >
          返回编辑
        </Button>
      </div>

      {/* 书壳 */}
      <section className="flex flex-col items-center text-center">
        <Cover work={work} />
        <h1 className="mt-8 font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          {work.title}
        </h1>
        {work.author ? <p className="mt-2 text-base text-muted-foreground">{work.author}</p> : null}
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {work.language.toUpperCase()}
          {hasParts ? <span> · 共 {parts.length} 章</span> : null}
        </p>
        {work.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {work.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-deep">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {work.description ? (
          <p className="mt-6 max-w-[60ch] font-reading text-base leading-7 text-foreground/90">{work.description}</p>
        ) : null}
      </section>

      <div className="mx-auto mt-10 h-px w-12 bg-outline/50" aria-hidden />

      {/* 状态：解析中 / 失败 / 无章节 */}
      {!isEpub ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">文本作品（内部种子），无 EPUB 内容。</p>
      ) : work.status === 'uploaded' || work.status === 'processing' ? (
        <div className="mt-10 rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {work.status === 'uploaded' ? '文件已上传，请在编辑页点击「开始解析」。' : '作品解析中，章节即将生成…'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">可返回编辑页查看进度。</p>
        </div>
      ) : work.status === 'failed' ? (
        <div className="mt-10 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
          <TriangleAlert className="mx-auto size-8 text-destructive" />
          <p className="mt-3 font-heading text-base font-semibold text-destructive">解析失败</p>
          <p className="mt-1 text-sm text-muted-foreground">{String(work.originMeta.lastError ?? '未知错误')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-6"
            nativeButton={false}
            render={<Link href={ADMIN_ROUTES.workDetail(work.id)} />}
          >
            返回编辑重新解析
          </Button>
        </div>
      ) : !hasParts ? (
        <div className="mt-10 rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <BookOpen className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-heading text-base font-medium">暂无章节内容</p>
          <p className="mt-1 text-sm text-muted-foreground">完成解析后即可在此审查章节。</p>
        </div>
      ) : (
        /* 章节目录 */
        <section className="mt-10 rounded-2xl border border-border bg-card px-4 py-4 md:px-6">
          <ol className="divide-y divide-border">
            {parts.map((part, index) => (
              <li key={part.id}>
                <Link
                  href={ADMIN_ROUTES.workPreviewPart(work.id, part.id)}
                  className="group flex items-baseline gap-4 rounded-lg px-3 py-3.5 transition-colors hover:bg-surface-container-low"
                >
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-base text-foreground transition-colors group-hover:text-brand-deep">
                    {part.title || `章节 ${index + 1}`}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    阅读 →
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
