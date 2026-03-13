'use client';

import { useEffect, useState } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [isDebug, setIsDebug] = useState(false);
  const [persistedLogs, setPersistedLogs] = useState<string[]>([]);

  useEffect(() => {
    console.error(error);
    try {
      const params = new URLSearchParams(window.location.search);
      const debugEnabled = params.get('debug') === '1';
      setIsDebug(debugEnabled);

      if (debugEnabled) {
        const raw = sessionStorage.getItem('__schedule_debug_logs');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setPersistedLogs(parsed.map(String));
        }
      }
    } catch {}
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <h2 className="text-2xl font-bold">Noget gik galt</h2>
      <p className="text-gray-500">Der opstod en uventet fejl. Prøv igen.</p>
      {isDebug && (
        <div className="w-full max-w-3xl rounded border border-amber-500/60 bg-amber-50 p-3 text-left">
          <div className="text-xs font-semibold text-amber-800 mb-2">Debug details</div>
          <pre className="text-[11px] leading-4 text-amber-900 whitespace-pre-wrap break-words max-h-64 overflow-auto">
{`message: ${error?.message || 'unknown'}
digest: ${error?.digest || 'none'}
stack: ${error?.stack || 'none'}
`}
{persistedLogs.length ? `\nrecent logs:\n${persistedLogs.join('\n')}` : ''}
          </pre>
        </div>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        Prøv igen
      </button>
    </div>
  );
}
