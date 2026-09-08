'use client';

import { Streamdown } from 'streamdown';

import { cn } from '@/lib/utils';

type ReaderMarkdownProps = {
  content: string;
  streaming?: boolean;
  className?: string;
};

export function ReaderMarkdown({ content, streaming, className }: ReaderMarkdownProps) {
  if (!content) {
    if (streaming) {
      return (
        <div className={cn('text-sm leading-[1.65] text-foreground', className)}>
          <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-xs bg-primary/70 align-middle" />
        </div>
      );
    }
    return null;
  }

  return (
    <div className={cn('text-sm leading-[1.65] text-foreground', className)}>
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        controls={false}
        components={{
          p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-[1.65]">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => (
            <h3 className="mb-2 mt-3 font-heading text-base font-semibold text-foreground">{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 className="mb-1.5 mt-2.5 font-heading text-sm font-semibold text-foreground">{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 className="mb-1 mt-2 font-heading text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {children}
            </h5>
          ),
          ul: ({ children }) => <ul className="my-2 list-disc pl-4 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-4 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-primary/50 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="my-2.5 max-w-full overflow-x-auto rounded-xl border border-border/40 bg-surface-container-high p-3 font-mono text-xs text-foreground">
              {children}
            </pre>
          ),
          inlineCode: ({ children }) => (
            <code className="rounded-md border border-border/40 bg-surface-container-high px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-brand-deep"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </Streamdown>
    </div>
  );
}
