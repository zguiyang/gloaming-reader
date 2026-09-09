import Link from 'next/link';

import { AUTH_ROUTES } from '@/constants';
import { formatMinutes, type RelatedBookCard } from '@/features/book-detail/book-detail-model';
import { WorkCover } from '@/features/work-cover';
import { cn } from '@/lib/utils';

export function BookDetailRelated({
  books,
  title = '您可能也会喜欢',
  showDivider = true,
}: {
  books: RelatedBookCard[];
  title?: string;
  showDivider?: boolean;
}) {
  if (books.length === 0) {
    return null;
  }

  return (
    <section className={cn('w-full space-y-5 md:space-y-6', showDivider && 'border-t border-border/50 pt-8')}>
      <h2 className="font-heading text-left text-xl font-semibold text-foreground md:text-2xl">{title}</h2>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-6 md:overflow-visible md:px-0 md:pb-0">
        {books.map((book) => (
          <Link
            key={book.id}
            href={AUTH_ROUTES.bookDetail(book.id)}
            className={cn(
              'group w-32 shrink-0 snap-start outline-none md:w-auto',
              'transition-transform duration-300 ease-out-soft hover:-translate-y-0.5',
              'focus-visible:ring-3 focus-visible:ring-ring/50',
            )}
          >
            <WorkCover
              title={book.title}
              tags={book.tags}
              coverImageUrl={book.coverImageUrl}
              className="aspect-[2/3] w-full rounded-lg"
            />
            <h3 className="font-heading mt-3 line-clamp-2 text-sm font-semibold text-foreground transition-colors duration-200 ease-out-soft group-hover:text-primary md:text-base">
              {book.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {[book.difficultyLabel ? `难度: ${book.difficultyLabel}` : null, formatMinutes(book.estimatedMinutes)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
