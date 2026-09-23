'use client';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import type { ClassificationJersey, ClassificationJerseys } from '@/types/admin';

type Slot = 'individual' | 'sprint' | 'kom';

const SLOTS: { key: Slot; label: string }[] = [
    { key: 'individual', label: 'Individuel' },
    { key: 'sprint', label: 'Sprint' },
    { key: 'kom', label: 'KOM' },
];

interface CatalogJersey {
    signature: number;
    name: string;
    imageName?: string;
    imageUrl?: string | null;
}

interface Props {
    user: User | null;
    saved: ClassificationJerseys | null | undefined;
    onSaved: () => void;
}

export default function ClassificationJerseysEditor({ user, saved, onSaved }: Props) {
    const [draft, setDraft] = useState<Record<Slot, ClassificationJersey | null>>({
        individual: null,
        sprint: null,
        kom: null,
    });
    const [queries, setQueries] = useState<Record<Slot, string>>({ individual: '', sprint: '', kom: '' });
    const [results, setResults] = useState<Record<Slot, CatalogJersey[]>>({ individual: [], sprint: [], kom: [] });
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');

    useEffect(() => {
        setDraft({
            individual: saved?.individual ?? null,
            sprint: saved?.sprint ?? null,
            kom: saved?.kom ?? null,
        });
    }, [saved]);

    useEffect(() => {
        const handles = SLOTS.map((slot) => {
            const q = queries[slot.key].trim();
            if (q.length < 2) {
                setResults((prev) => ({ ...prev, [slot.key]: [] }));
                return 0;
            }
            return window.setTimeout(async () => {
                const res = await fetch(`${API_URL}/jerseys?q=${encodeURIComponent(q)}&limit=25`);
                if (!res.ok) return;
                const data = await res.json();
                setResults((prev) => ({ ...prev, [slot.key]: data.jerseys || [] }));
            }, 250);
        });
        return () => {
            handles.forEach((handle) => {
                if (handle) window.clearTimeout(handle);
            });
        };
    }, [queries]);

    const choose = (slot: Slot, jersey: CatalogJersey) => {
        setDraft((prev) => ({
            ...prev,
            [slot]: {
                jerseySignature: jersey.signature,
                jerseyName: jersey.name,
                imageName: jersey.imageName,
                imageUrl: jersey.imageUrl,
            },
        }));
        setQueries((prev) => ({ ...prev, [slot]: '' }));
        setResults((prev) => ({ ...prev, [slot]: [] }));
    };

    const save = async () => {
        if (!user) return;
        setBusy(true);
        setStatus('');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/classification-jerseys`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    individual: draft.individual,
                    sprint: draft.sprint,
                    kom: draft.kom,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(data.message || 'Kunne ikke gemme konkurrencetrøjer');
                return;
            }
            setStatus('Konkurrencetrøjer gemt.');
            onSaved();
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="border border-border rounded-lg p-4 space-y-4 bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Konkurrencetrøjer</h3>
                    <p className="text-sm text-muted-foreground">
                        Vælg trøjerne fra Zwift-kataloget. Individuel vises på sæsonføreren, Sprint og KOM på førerne i de konkurrencer.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={busy || !user}
                    className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                >
                    Gem trøjer
                </button>
            </div>
            {status && <p className="text-sm text-muted-foreground">{status}</p>}
            <div className="grid gap-4 md:grid-cols-3">
                {SLOTS.map((slot) => {
                    const current = draft[slot.key];
                    return (
                        <div key={slot.key} className="space-y-2">
                            <div className="text-sm font-medium text-foreground">{slot.label}</div>
                            <div className="flex items-center gap-2">
                                <div className="w-10 h-10 rounded border border-border bg-background overflow-hidden flex items-center justify-center shrink-0">
                                    {current?.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={current.imageUrl} alt={current.jerseyName} className="w-full h-full object-contain" />
                                    ) : (
                                        <span className="text-[9px] text-muted-foreground">—</span>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm truncate">{current?.jerseyName || 'Ingen valgt'}</div>
                                    {current && (
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:text-foreground"
                                            onClick={() => setDraft((prev) => ({ ...prev, [slot.key]: null }))}
                                        >
                                            Fjern
                                        </button>
                                    )}
                                </div>
                            </div>
                            <input
                                type="search"
                                value={queries[slot.key]}
                                onChange={(e) => setQueries((prev) => ({ ...prev, [slot.key]: e.target.value }))}
                                placeholder="Søg trøje"
                                className="w-full p-2 text-sm border border-input rounded bg-background text-foreground"
                            />
                            {results[slot.key].length > 0 && (
                                <ul className="max-h-40 overflow-y-auto border border-border rounded bg-background">
                                    {results[slot.key].map((jersey) => (
                                        <li key={jersey.signature}>
                                            <button
                                                type="button"
                                                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                                                onClick={() => choose(slot.key, jersey)}
                                            >
                                                {jersey.imageUrl && (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={jersey.imageUrl} alt="" className="w-8 h-8 object-contain" />
                                                )}
                                                <span className="truncate">{jersey.name}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
