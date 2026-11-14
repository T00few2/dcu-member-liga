'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { DUAL_EXPERIMENTAL_DA } from '@/lib/dualRecording/copy';
import type { DualSummary } from '@/lib/dualRecording/samples';

interface Props {
    raceId: string;
    raceName?: string;
    onUploaded: () => void;
}

export default function FitUploadControl({ raceId, raceName, onUploaded }: Props) {
    const { user } = useAuth();
    const [file, setFile] = useState<File | null>(null);
    const [summary, setSummary] = useState<DualSummary | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const send = async (commit: boolean) => {
        if (!user || !file) return;
        setBusy(true);
        setError('');
        try {
            const token = await user.getIdToken();
            const body = new FormData();
            body.set('file', file);
            const res = await fetch(
                `${API_URL}/profile/races/${raceId}/dual-recording/fit?commit=${commit ? '1' : '0'}`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body },
            );
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.message || 'Filen kunne ikke læses');
            setSummary(payload.summary || null);
            if (commit) onUploaded();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Filen kunne ikke læses');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <div className="font-semibold">{raceName || 'Løb'}</div>
            <p className="text-amber-800 dark:text-amber-200">{DUAL_EXPERIMENTAL_DA}</p>
            <input
                type="file"
                accept=".fit,application/octet-stream"
                onChange={(event) => {
                    setSummary(null);
                    setFile(event.target.files?.[0] ?? null);
                }}
            />
            {file && !summary && (
                <button type="button" disabled={busy} className="underline" onClick={() => void send(false)}>
                    {busy ? 'Læser…' : 'Vis opsummering'}
                </button>
            )}
            {summary && (
                <div className="space-y-1">
                    <div>Tid: {summary.durationSec} sek</div>
                    <div>Watt: {summary.avgPower ?? '—'}</div>
                    <div>Kadence: {summary.avgCadence ?? '—'}</div>
                    <div>Puls: {summary.avgHr ?? '—'}</div>
                    <div>Andel med watt: {summary.powerCoveragePct} %</div>
                    <button
                        type="button"
                        disabled={busy}
                        className="rounded bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                        onClick={() => void send(true)}
                    >
                        {busy ? 'Sender…' : 'Upload'}
                    </button>
                </div>
            )}
            {error && <p className="text-red-600">{error}</p>}
        </div>
    );
}
