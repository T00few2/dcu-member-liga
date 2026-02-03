'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type PolicyDoc = {
  policyKey: string;
  version: string;
  titleDa: string;
  contentMdDa: string;
  changeSummary?: string;
  publishedAt?: number | null;
};

export default function DataPolicyPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [policy, setPolicy] = useState<PolicyDoc | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError('');
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const res = await fetch(`${apiUrl}/policy/dataPolicy/current`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Kunne ikke hente datapolitik.');
        setPolicy(data as PolicyDoc);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Der skete en fejl.');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  return (
    <div className="max-w-4xl mx-auto mt-10 p-8 bg-card rounded-lg shadow-md border border-border">
      <h1 className="text-3xl font-bold mb-2 text-card-foreground">{policy?.titleDa || 'Datapolitik'}</h1>
      <p className="text-sm text-muted-foreground mb-8">
        {policy?.version ? `Version ${policy.version}` : ''}
      </p>

      {loading ? (
        <div className="text-muted-foreground">Indlæser...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-md mb-6 border border-red-200">
          {error}
        </div>
      ) : policy ? (
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{policy.contentMdDa}</ReactMarkdown>
          <hr />
          <p className="text-sm text-muted-foreground">
            Tilbage til{' '}
            <Link href="/register" className="text-primary hover:underline">
              registrering
            </Link>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}

