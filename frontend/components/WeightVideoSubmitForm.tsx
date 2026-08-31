'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface Props {
    onSubmitted: () => void;
    submitLabel?: string;
    validDays?: number;
    compact?: boolean;
}

export default function WeightVideoSubmitForm({
    onSubmitted,
    submitLabel = 'Indsend verifikation',
    validDays = 30,
    compact = false,
}: Props) {
    const { user } = useAuth();
    const [linkInput, setLinkInput] = useState('');
    const [weighInDate, setWeighInDate] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const todayIso = localIsoDate(new Date());
    const stale = Boolean(weighInDate && daysBetween(weighInDate, todayIso) > validDays);

    const handleSubmit = async () => {
        if (!user || !linkInput || !weighInDate) return;
        if (!linkInput.startsWith('http')) {
            setError('Indtast venligst en gyldig URL (der starter med http:// eller https://)');
            return;
        }
        setSubmitting(true);
        setError('');
        setSuccess('');
        try {
            const idToken = await user.getIdToken();
            const res = await fetch(`${API_URL}/verification/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ videoLink: linkInput, weighInDate }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Kunne ikke indsende verifikation');
            setSuccess('Verifikation indsendt med succes! En administrator vil snart gennemgå den.');
            onSubmitted();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Kunne ikke indsende');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className={compact ? 'space-y-4' : 'bg-card p-6 border border-border rounded-lg shadow-sm space-y-4'}>
            {!compact && <h4 className="font-semibold text-card-foreground">Indsend verifikationsvideo</h4>}
            {!compact && (
            <div className="text-sm text-muted-foreground space-y-2">
                <p><strong>Instruktioner:</strong></p>
                <ol className="list-decimal pl-5 space-y-1">
                    <li>
                        Følg{' '}
                        <a
                            href="https://youtu.be/9EDuSQwsPSg?si=1gyEg5n_z0MT0d3H"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium"
                        >
                            vejledningsvideoen
                        </a>
                        {' '}trin for trin for at lave indvejningsvideoen.
                    </li>
                    <li>Upload videoen til YouTube (vælg &quot;Skjult&quot; som synlighed).</li>
                    <li>Angiv datoen for selve indvejningen (ikke nødvendigvis uploaddagen).</li>
                    <li>Indsæt et link, der kan deles, nedenfor.</li>
                </ol>
            </div>
            )}
            <div>
                <label className="block text-sm font-medium mb-1">Dato for indvejning</label>
                <input
                    type="date"
                    value={weighInDate}
                    max={todayIso}
                    onChange={(e) => setWeighInDate(e.target.value)}
                    className="w-full p-3 border border-input rounded bg-background text-foreground"
                    required
                />
                {stale && (
                    <p className="text-amber-700 dark:text-amber-300 text-xs mt-1">
                        Denne dato er ældre end {validDays} dage. En godkendelse vil allerede være udløbet.
                    </p>
                )}
            </div>
            <div>
                <label className="block text-sm font-medium mb-1">Videolink</label>
                <input
                    type="url"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder="https://youtube.com/..."
                    className="w-full p-3 border border-input rounded bg-background text-foreground"
                />
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            {success && <div className="text-green-600 text-sm">{success}</div>}
            <button
                onClick={handleSubmit}
                disabled={submitting || !linkInput || !weighInDate}
                className="w-full py-3 bg-primary text-primary-foreground font-bold rounded hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
                {submitting ? 'Indsender...' : submitLabel}
            </button>
        </div>
    );
}

function localIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function daysBetween(fromIso: string, toIso: string): number {
    const from = Date.parse(`${fromIso}T00:00:00`);
    const to = Date.parse(`${toIso}T00:00:00`);
    if (Number.isNaN(from) || Number.isNaN(to)) return 0;
    return Math.round((to - from) / 86400000);
}
