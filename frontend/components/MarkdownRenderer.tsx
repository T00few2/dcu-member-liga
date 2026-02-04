'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ');
}

const components: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cx('mt-6 mb-3 text-2xl font-bold', className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cx('mt-6 mb-2 text-xl font-semibold', className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cx('mt-5 mb-2 text-lg font-semibold', className)} {...props} />
  ),
  h4: ({ className, ...props }) => (
    <h4 className={cx('mt-4 mb-2 text-base font-semibold', className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cx('my-3 leading-relaxed', className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cx('my-3 list-disc pl-6', className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cx('my-3 list-decimal pl-6', className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cx('my-1', className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cx('text-primary hover:underline', className)}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cx('my-6 border-border', className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cx('my-4 border-l-4 border-border pl-4 text-muted-foreground', className)}
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => (
    <code
      className={cx(
        'rounded bg-muted/30 px-1 py-0.5 font-mono text-[0.85em]',
        className
      )}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cx(
        'my-4 overflow-x-auto rounded border border-border bg-muted/20 p-3 text-sm',
        className
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-4 overflow-x-auto rounded border border-border">
      <table
        className={cx(
          'w-full min-w-[900px] border-collapse text-sm',
          'bg-background',
          className
        )}
        {...props}
      />
    </div>
  ),
  thead: ({ className, ...props }) => (
    <thead className={cx('bg-muted/30', className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cx(
        'border-b border-border px-3 py-2 text-left align-top font-semibold',
        'whitespace-nowrap',
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cx(
        'border-b border-border px-3 py-2 text-left align-top',
        'whitespace-normal',
        className
      )}
      {...props}
    />
  ),
};

export default function MarkdownRenderer({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  );
}

