'use client';

import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';

import type { PartSummary } from '@gloaming/shared/works';

import { Button } from '@/components/ui/button';
import { adjacentPart } from '@/features/reader/reader-model';

type ReaderChapterNavProps = {
  parts: PartSummary[];
  currentPartId: string;
  nextTitle: string | null;
  hasNext: boolean;
  isLastChapter: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onFinish: () => void;
};

export function ReaderChapterNav({
  parts,
  currentPartId,
  nextTitle,
  hasNext,
  isLastChapter,
  onPrevious,
  onNext,
  onFinish,
}: ReaderChapterNavProps) {
  const prevPart = adjacentPart(parts, currentPartId, 'prev');

  return (
    <section
      data-reader-ui
      className="mt-16 flex flex-col items-center border-t border-border/40 pt-16 pb-8 text-center md:mt-32"
      onClick={(e) => e.stopPropagation()}
    >
      {hasNext && nextTitle ? (
        <>
          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">接下来</p>
          <h3 className="mb-10 max-w-md font-heading text-xl font-semibold text-primary md:text-2xl">{nextTitle}</h3>
        </>
      ) : isLastChapter ? (
        <p className="mb-8 text-sm text-muted-foreground">已是最后一章</p>
      ) : null}

      <div className="flex w-full max-w-sm flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        {prevPart ? (
          <Button type="button" variant="ghost" className="gap-2 text-muted-foreground" onClick={onPrevious}>
            <ArrowLeftIcon className="size-4" strokeWidth={1.5} aria-hidden />
            上一章
          </Button>
        ) : (
          <span />
        )}

        {hasNext ? (
          <Button type="button" className="gap-2 hover:bg-brand-deep" onClick={onNext}>
            继续阅读
            <ArrowRightIcon className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        ) : (
          <Button type="button" variant="outline" className="gap-2" onClick={onFinish}>
            读完本书，返回书架
          </Button>
        )}
      </div>
    </section>
  );
}
