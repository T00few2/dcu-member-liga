'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ');
}

const components: Components = {
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

