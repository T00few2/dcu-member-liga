'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

interface ClubKitsTabProps {
    user: User | null;
}

type CodeStatus = 'working' | 'expired' | 'unverified';

interface JerseyUnlock {
    jerseySignature: number;
    jerseyName: string;
    imageName?: string;
    imageUrl?: string | null;
    minLevel?: number | null;
    unlockCode?: string | null;
    codeStatus?: CodeStatus;
    codeCheckedAt?: string | null;
}

interface JerseyTableRow extends JerseyUnlock {
    pinnedOnly?: boolean;
    pinnedClub?: string | null;
}

interface ClubKitRow {
    club: string;
    jerseySignature: number;
    jerseyName: string;
    imageName?: string;
    imageUrl?: string | null;
    assignment: string;
    source?: string;
    notes?: string | null;
}

interface ClubSummary {
    club: string;
    memberCount: number;
    knownLevels: number;
    unknownLevels: number;
    minDropLevel: number | null;
    poolSize: number;
    pinned: boolean;
    kit: ClubKitRow | null;
}

interface Overview {
    jerseyUnlocks: JerseyUnlock[];
    clubKits: ClubKitRow[];
    riders: { total: number; withClub: number; knownDropLevel: number; unknownDropLevel: number };
    preview: {
        clubs: ClubSummary[];
        emptyPools: { club: string; reason: string }[];
        coverage: {
            assignedClubs: number;
            totalClubs: number;
            percent: number;
            pinnedCount: number;
            autoCount: number;
            emptyCount: number;
            uniqueAuto: number;
            sharedJerseyCount: number;
        };
    };
}

interface CatalogJersey {
    signature: number;
    name: string;
    imageName: string;
    imageUrl?: string | null;
}

export default function ClubKitsTab({ user }: ClubKitsTabProps) {
    const [overview, setOverview] = useState<Overview | null>(null);
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<CatalogJersey[]>([]);
    const [minLevel, setMinLevel] = useState('');
    const [unlockCode, setUnlockCode] = useState('');
    const [codeStatus, setCodeStatus] = useState<CodeStatus>('unverified');
    const [selectedJersey, setSelectedJersey] = useState<CatalogJersey | null>(null);
    const [pinClub, setPinClub] = useState('');
    const [pinNotes, setPinNotes] = useState('');
    const [pinJersey, setPinJersey] = useState<CatalogJersey | null>(null);

    const authHeaders = useCallback(async () => {
        const token = await user?.getIdToken();
        return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    }, [user]);

    const loadOverview = useCallback(async () => {
        if (!user) return;
        const headers = await authHeaders();
        const res = await fetch(`${API_URL}/admin/club-kits/overview`, { headers });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setStatus(data.message || 'Kunne ikke hente klubtrøjer');
            return;
        }
        setOverview(await res.json());
    }, [authHeaders, user]);

    useEffect(() => {
        void loadOverview();
    }, [loadOverview]);

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) {
            setResults([]);
            return;
        }
        const handle = window.setTimeout(async () => {
            const res = await fetch(`${API_URL}/jerseys?q=${encodeURIComponent(q)}&limit=25`);
            if (!res.ok) return;
            const data = await res.json();
            setResults(data.jerseys || []);
        }, 250);
        return () => window.clearTimeout(handle);
    }, [search]);

    const unlocks = overview?.jerseyUnlocks || [];
    const coverage = overview?.preview?.coverage;
    const clubs = overview?.preview?.clubs || [];
    const jerseyClubCount = useMemo(() => {
        const counts: Record<number, number> = {};
        for (const club of clubs) {
            const signature = club.kit?.jerseySignature;
            if (typeof signature !== 'number') continue;
            counts[signature] = (counts[signature] || 0) + 1;
        }
        return counts;
    }, [clubs]);

    const jerseyTableRows = useMemo(() => {
        const bySig = new Map<number, JerseyTableRow>();
        for (const row of unlocks) {
            bySig.set(row.jerseySignature, { ...row });
        }
        for (const kit of overview?.clubKits || []) {
            if (kit.assignment !== 'pinned' || typeof kit.jerseySignature !== 'number') continue;
            const existing = bySig.get(kit.jerseySignature);
            if (existing) {
                existing.pinnedClub = kit.club;
                continue;
            }
            bySig.set(kit.jerseySignature, {
                jerseySignature: kit.jerseySignature,
                jerseyName: kit.jerseyName,
                imageName: kit.imageName,
                imageUrl: kit.imageUrl,
                minLevel: null,
                unlockCode: null,
                pinnedOnly: true,
                pinnedClub: kit.club,
            });
        }
        const rows = [...bySig.values()];
        rows.sort((a, b) => {
            if (Boolean(a.pinnedOnly) !== Boolean(b.pinnedOnly)) return a.pinnedOnly ? -1 : 1;
            return (a.jerseyName || '').localeCompare(b.jerseyName || '', 'da');
        });
        return rows;
    }, [unlocks, overview?.clubKits]);

    const saveUnlocks = async (next: JerseyUnlock[]) => {
        setBusy(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`${API_URL}/admin/jersey-unlocks`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ jerseyUnlocks: next }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(data.message || 'Kunne ikke gemme unlock-index');
                return;
            }
            setStatus('Unlock-index gemt');
            await loadOverview();
        } finally {
            setBusy(false);
        }
    };

    const addUnlock = async () => {
        if (!selectedJersey) return;
        const next: JerseyUnlock[] = [
            ...unlocks.filter((row) => row.jerseySignature !== selectedJersey.signature),
            {
                jerseySignature: selectedJersey.signature,
                jerseyName: selectedJersey.name,
                imageName: selectedJersey.imageName,
                imageUrl: selectedJersey.imageUrl,
                minLevel: minLevel ? Number(minLevel) : null,
                unlockCode: unlockCode.trim() || null,
                codeStatus: unlockCode.trim() ? codeStatus : undefined,
            },
        ];
        await saveUnlocks(next);
        setSelectedJersey(null);
        setMinLevel('');
        setUnlockCode('');
        setCodeStatus('unverified');
        setSearch('');
        setResults([]);
    };

    const removeUnlock = async (signature: number) => {
        await saveUnlocks(unlocks.filter((row) => row.jerseySignature !== signature));
    };

    const updateUnlockStatus = async (signature: number, nextStatus: CodeStatus) => {
        await saveUnlocks(
            unlocks.map((row) => (
                row.jerseySignature === signature
                    ? { ...row, codeStatus: nextStatus, codeCheckedAt: new Date().toISOString() }
                    : row
            )),
        );
    };

    const pinSelected = async () => {
        if (!pinClub.trim() || !pinJersey) return;
        setBusy(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`${API_URL}/admin/club-kits/pin`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    club: pinClub.trim(),
                    jerseySignature: pinJersey.signature,
                    jerseyName: pinJersey.name,
                    imageName: pinJersey.imageName,
                    imageUrl: pinJersey.imageUrl,
                    notes: pinNotes.trim() || null,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(data.message || 'Kunne ikke pinne trøje');
                return;
            }
            setStatus(`Pinned ${pinClub}`);
            setPinNotes('');
            await loadOverview();
        } finally {
            setBusy(false);
        }
    };

    const unpinClub = async (club: string) => {
        setBusy(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`${API_URL}/admin/club-kits/unpin`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ club }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setStatus(data.message || 'Kunne ikke unpinne');
                return;
            }
            await loadOverview();
        } finally {
            setBusy(false);
        }
    };

    const seedKnown = async () => {
        setBusy(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`${API_URL}/admin/jersey-unlocks/seed`, { method: 'POST', headers });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(data.message || 'Kunne ikke indlæse kendte unlocks');
                return;
            }
            setStatus(data.message || 'Kendte unlocks indlæst');
            await loadOverview();
        } finally {
            setBusy(false);
        }
    };

    const applyAuto = async () => {
        setBusy(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`${API_URL}/admin/club-kits/apply`, { method: 'POST', headers });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(data.message || 'Auto-tildeling fejlede');
                return;
            }
            setStatus('Auto-tildeling gemt (pins uændrede)');
            await loadOverview();
        } finally {
            setBusy(false);
        }
    };

    const refreshLevels = async () => {
        setBusy(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`${API_URL}/admin/club-kits/refresh-drop-levels`, { method: 'POST', headers });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(data.message || 'Level-refresh fejlede');
                return;
            }
            setStatus(`Levels opdateret: ${data.updated}/${data.total} (skip ${data.skipped}, fail ${data.failed})`);
            await loadOverview();
        } finally {
            setBusy(false);
        }
    };

    const clubOptions = useMemo(() => clubs.map((c) => c.club), [clubs]);

    const jerseyThumb = (url?: string | null, name?: string) => (
        <div className="w-10 h-10 rounded border border-border bg-background overflow-hidden flex items-center justify-center shrink-0">
            {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={name || ''} className="w-full h-full object-contain" />
            ) : (
                <span className="text-[9px] text-muted-foreground">—</span>
            )}
        </div>
    );

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-foreground">Klubtrøjer</h2>
                    <p className="text-sm text-muted-foreground">
                        Level-auto og working P-koder danner puljen. Ukendt rytter-level tælles som 1
                        (starttrøjer alle har). En pinnet trøje er kun til den klub og tildeles aldrig automatisk til andre.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => void refreshLevels()}
                        disabled={busy}
                        className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-secondary/50 disabled:opacity-50"
                    >
                        Opdater rytter-levels
                    </button>
                    <button
                        type="button"
                        onClick={() => void applyAuto()}
                        disabled={busy}
                        className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
                    >
                        Anvend auto-tildeling
                    </button>
                </div>
            </div>

            {status && <p className="text-sm text-muted-foreground">{status}</p>}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Ryttere med level" value={`${overview?.riders.knownDropLevel ?? 0}/${overview?.riders.total ?? 0}`} />
                <Stat label="Dækning" value={`${coverage?.percent ?? 0}%`} />
                <Stat label="Pinned / auto" value={`${coverage?.pinnedCount ?? 0} / ${coverage?.autoCount ?? 0}`} />
                <Stat label="Unikke auto / doubles" value={`${coverage?.uniqueAuto ?? 0} / ${coverage?.sharedJerseyCount ?? 0}`} />
            </div>

            <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">Unlock-index</h3>
                    <button
                        type="button"
                        onClick={() => void seedKnown()}
                        disabled={busy}
                        className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-secondary/50 disabled:opacity-50"
                    >
                        Indlæs kendte level- og kode-trøjer
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Fylder index med level-auto kits (ZwiftInsider) og publicerede P-koder (Zwift Wiki).
                    Koder gemmes som unverified — ret til working/expired efter du har prøvet dem. Overskriver ikke rækker du allerede har rettet.
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Søg trøje (navn, imageName, signature)"
                            className="w-full p-2 border border-input rounded-lg bg-background"
                        />
                        <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
                            {results.map((jersey) => (
                                <button
                                    key={jersey.signature}
                                    type="button"
                                    onClick={() => {
                                        setSelectedJersey(jersey);
                                        setPinJersey(jersey);
                                    }}
                                    className={`w-full flex items-center gap-2 p-2 text-left hover:bg-secondary/50 ${
                                        selectedJersey?.signature === jersey.signature ? 'bg-secondary/70' : ''
                                    }`}
                                >
                                    {jerseyThumb(jersey.imageUrl, jersey.name)}
                                    <span className="text-sm">{jersey.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm">{selectedJersey ? `Valgt: ${selectedJersey.name}` : 'Vælg en trøje i søgningen'}</p>
                        <input
                            value={minLevel}
                            onChange={(e) => setMinLevel(e.target.value)}
                            placeholder="minLevel (auto-grant)"
                            className="w-full p-2 border border-input rounded-lg bg-background"
                        />
                        <input
                            value={unlockCode}
                            onChange={(e) => setUnlockCode(e.target.value)}
                            placeholder="P-kode (valgfri)"
                            className="w-full p-2 border border-input rounded-lg bg-background"
                        />
                        <select
                            value={codeStatus}
                            onChange={(e) => setCodeStatus(e.target.value as CodeStatus)}
                            className="w-full p-2 border border-input rounded-lg bg-background"
                        >
                            <option value="working">working</option>
                            <option value="expired">expired</option>
                            <option value="unverified">unverified</option>
                        </select>
                        <button
                            type="button"
                            onClick={() => void addUnlock()}
                            disabled={busy || !selectedJersey}
                            className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
                        >
                            Gem i unlock-index
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="p-2 text-left">Trøje</th>
                                <th className="p-2 text-left">Level</th>
                                <th className="p-2 text-left">Kode</th>
                                <th className="p-2 text-left">Status</th>
                                <th className="p-2 text-left">Klubber</th>
                                <th className="p-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {jerseyTableRows.map((row) => (
                                <tr key={row.jerseySignature} className="border-t border-border">
                                    <td className="p-2">
                                        <div className="flex items-center gap-2">
                                            {jerseyThumb(row.imageUrl, row.jerseyName)}
                                            <div>
                                                <div>{row.jerseyName}</div>
                                                {row.pinnedClub && (
                                                    <div className="text-xs text-muted-foreground">
                                                        Pinnet: {row.pinnedClub}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-2">{row.minLevel ?? '—'}</td>
                                    <td className="p-2 font-mono">{row.unlockCode || '—'}</td>
                                    <td className="p-2">
                                        {row.pinnedOnly ? (
                                            'pinnet'
                                        ) : row.unlockCode ? (
                                            <select
                                                value={row.codeStatus || 'unverified'}
                                                onChange={(e) => void updateUnlockStatus(row.jerseySignature, e.target.value as CodeStatus)}
                                                className="p-1 border border-input rounded bg-background"
                                            >
                                                <option value="working">working</option>
                                                <option value="expired">expired</option>
                                                <option value="unverified">unverified</option>
                                            </select>
                                        ) : '—'}
                                    </td>
                                    <td className="p-2">{clubCountLabel(jerseyClubCount[row.jerseySignature] || 0)}</td>
                                    <td className="p-2 text-right">
                                        {!row.pinnedOnly && (
                                            <button type="button" className="text-red-600 text-xs" onClick={() => void removeUnlock(row.jerseySignature)}>
                                                Fjern
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="font-semibold">Pin klubtrøje</h3>
                <div className="grid md:grid-cols-3 gap-2">
                    <select
                        value={pinClub}
                        onChange={(e) => setPinClub(e.target.value)}
                        className="p-2 border border-input rounded-lg bg-background"
                    >
                        <option value="">Vælg klub</option>
                        {clubOptions.map((club) => (
                            <option key={club} value={club}>{club}</option>
                        ))}
                    </select>
                    <input
                        value={pinNotes}
                        onChange={(e) => setPinNotes(e.target.value)}
                        placeholder="Notes (hvordan medlemmer får den)"
                        className="p-2 border border-input rounded-lg bg-background"
                    />
                    <button
                        type="button"
                        onClick={() => void pinSelected()}
                        disabled={busy || !pinClub || !pinJersey}
                        className="px-3 py-2 text-sm border border-border rounded-lg disabled:opacity-50"
                    >
                        Pin {pinJersey ? pinJersey.name : 'valgt trøje'}
                    </button>
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="font-semibold">Klubber og tildeling</h3>
                <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="p-2 text-left">Klub</th>
                                <th className="p-2 text-left">Medlemmer</th>
                                <th className="p-2 text-left">Levels</th>
                                <th className="p-2 text-left">Pool</th>
                                <th className="p-2 text-left">Trøje</th>
                                <th className="p-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {clubs.map((club) => (
                                <tr key={club.club} className="border-t border-border">
                                    <td className="p-2">{club.club}</td>
                                    <td className="p-2">{club.memberCount}</td>
                                    <td className="p-2">{club.knownLevels}/{club.memberCount}</td>
                                    <td className="p-2">{club.poolSize}</td>
                                    <td className="p-2">
                                        <div className="flex items-center gap-2">
                                            {jerseyThumb(club.kit?.imageUrl, club.kit?.jerseyName)}
                                            <span>
                                                {club.kit?.jerseyName || '—'}
                                                {club.pinned ? ' (pinned)' : club.kit ? ' (auto)' : ''}
                                                {club.kit?.jerseySignature != null
                                                    ? ` · ${clubCountLabel(jerseyClubCount[club.kit.jerseySignature] || 0)}`
                                                    : ''}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-2 text-right">
                                        {club.pinned && (
                                            <button type="button" className="text-xs text-muted-foreground" onClick={() => void unpinClub(club.club)}>
                                                Unpin
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {(overview?.preview.emptyPools || []).length > 0 && (
                    <div className="text-sm text-muted-foreground space-y-1">
                        {overview!.preview.emptyPools.map((row) => (
                            <p key={row.club}>{row.club}: {row.reason}</p>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function clubCountLabel(count: number): string {
    return count === 1 ? '1 klub' : `${count} klubber`;
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-3 border border-border rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
        </div>
    );
}
