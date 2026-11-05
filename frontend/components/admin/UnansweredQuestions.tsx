'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

export interface UnansweredQuestion {
  id: string;
  question: string;
  missing?: string;
  threadId?: string;
  guildId?: string | null;
  status: 'open' | 'resolved';
  createdAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  note?: string | null;
}

async function authed(user: User, path: string, init?: RequestInit) {
  const token = await user.getIdToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
}

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : '';
}

/** Link to the rider's thread in Discord (needs the server id the bot sent with the question). */
export function threadLink(q: Pick<UnansweredQuestion, 'guildId' | 'threadId'>): string | null {
  return q.guildId && q.threadId ? `https://discord.com/channels/${q.guildId}/${q.threadId}` : null;
}

function OpenQuestion({ q, onResolve, busy }: {
  q: UnansweredQuestion;
  onResolve: (note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState('');
  const link = threadLink(q);
  return (
    <div className="border border-border rounded-lg p-4 space-y-2 bg-card">
      <p className="font-medium text-card-foreground">“{q.question}”</p>
      {q.missing && <p className="text-sm text-muted-foreground">Missing: {q.missing}</p>}
      <p className="text-xs text-muted-foreground">
        {when(q.createdAt)}
        {link && <> · <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open the thread in Discord</a></>}
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What did you fix? (optional)"
          className="flex-1 min-w-[12rem] px-2 py-1.5 rounded border border-border bg-background text-sm"
        />
        <button
          disabled={busy}
          onClick={() => onResolve(note)}
          className="cursor-pointer px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Mark as solved'}
        </button>
      </div>
    </div>
  );
}

export default function UnansweredQuestions({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'open' | 'resolved'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { data, isLoading } = useQuery<{ items: UnansweredQuestion[] }>({
    queryKey: ['division-agent', 'unanswered', view],
    queryFn: () => authed(user!, `/admin/division-agent/unanswered?status=${view}`),
    enabled: !!user,
    refetchInterval: view === 'open' ? 60_000 : false,
  });
  const items = data?.items ?? [];

  async function resolve(id: string, note: string) {
    if (!user) return;
    setBusyId(id);
    setError('');
    try {
      await authed(user, `/admin/division-agent/unanswered/${id}/resolve`, {
        method: 'POST', body: JSON.stringify({ note }),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusyId(null);
      void queryClient.invalidateQueries({ queryKey: ['division-agent', 'unanswered'] });
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Questions the Discord help bot could not answer from the site, the settings or the news. Reply to the rider
        in the thread, then fix the gap at its source (settings, a news post, the Code of Conduct doc or the site
        text), so the bot can answer it next time.
      </p>
      <div className="flex gap-2 text-sm">
        {(['open', 'resolved'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`cursor-pointer px-3 py-1 rounded border ${view === v ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
          >
            {v === 'open' ? 'Open' : 'Solved'}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {view === 'open' ? 'No unanswered questions.' : 'Nothing solved yet.'}
        </p>
      )}
      {view === 'open' && items.map(q => (
        <OpenQuestion key={q.id} q={q} busy={busyId === q.id} onResolve={note => void resolve(q.id, note)} />
      ))}
      {view === 'resolved' && items.length > 0 && (
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="text-muted-foreground"><th className="py-1">Question</th><th>Solved by</th><th>When</th><th>Note</th></tr>
          </thead>
          <tbody>
            {items.map(q => (
              <tr key={q.id} className="border-t border-border">
                <td className="py-1">{q.question}</td>
                <td>{q.resolvedBy ?? ''}</td>
                <td>{when(q.resolvedAt)}</td>
                <td>{q.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
