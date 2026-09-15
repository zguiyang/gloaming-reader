'use client';

import { StarIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import type { BookDetail } from '@/features/book-detail/book-detail-model';
import { difficultyStarCount, formatMinutes, formatSuggestedVocabSize } from '@/features/book-detail/book-detail-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const STAR_TOTAL = 5;

export function BookDetailStats({ book }: { book: BookDetail }) {
  const { locale } = useLocale();
  const hasDifficulty = book.difficultyScore != null;
  const hasMinutes = book.estimatedMinutes != null;
  const hasVocab = book.suggestedVocabSize != null;

  if (!hasDifficulty && !hasMinutes && !hasVocab) {
    return null;
  }

  const colCount = [hasDifficulty, hasMinutes, hasVocab].filter(Boolean).length;
  const gridClass = colCount === 1 ? 'grid-cols-1' : colCount === 2 ? 'grid-cols-2' : 'grid-cols-3';

  const filled = hasDifficulty ? difficultyStarCount(book.difficultyScore!) : 0;
  const levelLabel = book.difficultyLabel ?? '';

  return (
    <section className="border-b border-border/50 pb-6 md:pb-8">
      <h2 className="font-heading mb-4 text-left text-xl font-semibold text-foreground md:mb-5 md:text-2xl">
        {t(locale, 'content.bookDetail.readInfo')}
      </h2>
      <div className={cn('grid w-full divide-x divide-border/50 text-center', gridClass)}>
        {hasDifficulty ? (
          <div className="px-2 md:px-4">
            <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t(locale, 'content.bookDetail.difficulty')}
            </p>
            <div
              className="mt-1 flex items-center justify-center gap-0.5"
              role="img"
              aria-label={t(locale, 'content.bookDetail.difficultyAria', {
                label: levelLabel,
                filled,
                total: STAR_TOTAL,
              })}
            >
              {Array.from({ length: STAR_TOTAL }, (_, i) => {
                const isFilled = i < filled;
                return (
                  <StarIcon
                    key={i}
                    className={cn(
                      'size-4 md:size-[18px]',
                      isFilled ? 'fill-primary text-primary' : 'fill-muted text-muted',
                    )}
                    strokeWidth={1.25}
                    aria-hidden
                  />
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{levelLabel}</p>
          </div>
        ) : null}
        {hasMinutes ? (
          <div className="px-2 md:px-4">
            <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t(locale, 'content.bookDetail.estimatedMinutes')}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground md:text-lg">
              {formatMinutes(book.estimatedMinutes!, locale)}
            </p>
          </div>
        ) : null}
        {hasVocab ? (
          <div className="px-2 md:px-4">
            <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t(locale, 'content.bookDetail.suggestedVocab')}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground md:text-lg">
              {t(locale, 'content.bookDetail.suggestedVocabApprox', {
                size: formatSuggestedVocabSize(book.suggestedVocabSize!),
              })}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
