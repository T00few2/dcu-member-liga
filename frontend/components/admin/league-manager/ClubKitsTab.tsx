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
    minLevel?: number | null;
}

interface BelowKitRider {
    name: string;
    dropLevel: number | null;
}

interface CodeBlockedRider {
    name: string;
    dropLevel: number | null;
    gameClientPlatform?: string | null;
}

interface ClubSummary {
    club: string;
    memberCount: number;
    knownLevels: number;
    unknownLevels: number;
    minDropLevel: number | null;
    pcMacCount?: number;
    poolSize: number;
    pinned: boolean;
    kit: ClubKitRow | null;
    kitMinLevel?: number | null;
    belowKitLevelCount?: number;
    belowKitLevel?: BelowKitRider[];
    atKitLevelCount?: number | null;
    cannotEnterCodeCount?: number;
    cannotEnterCode?: CodeBlockedRider[];
}

interface Overview {
    jerseyUnlocks: JerseyUnlock[];
    clubKits: ClubKitRow[];
    riders: { total: number; withClub: number; knownDropLevel: number; unknownDropLevel: number };
    riderCoverage?: {
        total: number;
        assigned: number;
        canObtain: number;
        percent: number;
    };
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
        riderCoverage?: {
            total: number;
            assigned: number;
            canObtain: number;
            percent: number;
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
    const [ignoreProposed, setIgnoreProposed] = useState(false);
    const [clubSort, setClubSort] = useState<{ key: 'club' | 'minLevel'; dir: 'asc' | 'desc' }>({
        key: 'club',
        dir: 'asc',
    });
    const [jerseySort, setJerseySort] = useState<{ key: 'name' | 'level'; dir: 'asc' | 'desc' }>({
        key: 'name',
        dir: 'asc',
    });

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
    const savedKits = overview?.clubKits || [];
    const savedByClub = useMemo(() => {
        const map = new Map<string, ClubKitRow>();
        for (const kit of savedKits) {
            if (kit.club) map.set(kit.club, kit);
        }
        return map;
    }, [savedKits]);
    const jerseyClubCount = useMemo(() => {
        const counts: Record<number, number> = {};
        for (const kit of savedKits) {
            if (typeof kit.jerseySignature !== 'number') continue;
            counts[kit.jerseySignature] = (counts[kit.jerseySignature] || 0) + 1;
        }
        return counts;
    }, [savedKits]);
    const savedCoverage = useMemo(() => {
        const pinned = savedKits.filter((kit) => kit.assignment === 'pinned');
        const auto = savedKits.filter((kit) => kit.assignment === 'auto');
        const usage = new Map<number, number>();
        for (const kit of savedKits) {
            if (typeof kit.jerseySignature !== 'number') continue;
            usage.set(kit.jerseySignature, (usage.get(kit.jerseySignature) || 0) + 1);
        }
        const uniqueAuto = auto.filter((kit) => (usage.get(kit.jerseySignature) || 0) === 1).length;
        const sharedJerseyCount = [...usage.values()].filter((count) => count > 1).length;
        const totalClubs = clubs.length;
        const assigned = pinned.length + auto.length;
        return {
            pinnedCount: pinned.length,
            autoCount: auto.length,
            uniqueAuto,
            sharedJerseyCount,
            missingCount: Math.max(0, totalClubs - assigned),
            percent: totalClubs ? Math.round((1000 * assigned) / totalClubs) / 10 : 0,
        };
    }, [savedKits, clubs.length]);
    const missingClubs = useMemo(
        () => clubs.filter((club) => savedByClub.get(club.club)?.jerseySignature == null),
        [clubs, savedByClub],
    );
    const emptyReasonByClub = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of overview?.preview.emptyPools || []) {
            map.set(row.club, row.reason);
        }
        return map;
    }, [overview?.preview.emptyPools]);
    const sortedClubs = useMemo(
        () => {
            const dir = clubSort.dir === 'asc' ? 1 : -1;
            return [...clubs].sort((a, b) => {
                if (clubSort.key === 'minLevel') {
                    const aLevel = a.minDropLevel;
                    const bLevel = b.minDropLevel;
                    const aUnknown = aLevel == null;
                    const bUnknown = bLevel == null;
                    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
                    if (aLevel != null && bLevel != null && aLevel !== bLevel) {
                        return (aLevel - bLevel) * dir;
                    }
                    return a.club.localeCompare(b.club, 'da');
                }
                const aMissing = savedByClub.get(a.club)?.jerseySignature == null;
                const bMissing = savedByClub.get(b.club)?.jerseySignature == null;
                if (aMissing !== bMissing) return aMissing ? -1 : 1;
                return a.club.localeCompare(b.club, 'da');
            });
        },
        [clubs, savedByClub, clubSort],
    );
    const clubsBelowKitLevel = useMemo(
        () => clubs.filter((club) => (club.belowKitLevelCount || 0) > 0),
        [clubs],
    );
    const clubsBlockedFromCode = useMemo(
        () => clubs.filter((club) => (club.cannotEnterCodeCount || 0) > 0),
        [clubs],
    );
    const previewDiffers = useMemo(
        () => {
            if (ignoreProposed) return false;
            return clubs.some((club) => {
                const savedSig = savedByClub.get(club.club)?.jerseySignature ?? null;
                const proposedSig = club.kit?.jerseySignature ?? null;
                return savedSig !== proposedSig;
            });
        },
        [clubs, savedByClub, ignoreProposed],
    );

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
        const dir = jerseySort.dir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            if (jerseySort.key === 'level') {
                const aLevel = a.minLevel;
                const bLevel = b.minLevel;
                const aMissing = aLevel == null;
                const bMissing = bLevel == null;
                if (aMissing !== bMissing) return aMissing ? 1 : -1;
                if (aLevel != null && bLevel != null && aLevel !== bLevel) {
                    return (aLevel - bLevel) * dir;
                }
            }
            return dir * (a.jerseyName || '').localeCompare(b.jerseyName || '', 'da');
        });
        return rows;
    }, [unlocks, overview?.clubKits, jerseySort]);

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

    const assignAutoSelected = async () => {
        if (!pinClub.trim() || !pinJersey) return;
        setBusy(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`${API_URL}/admin/club-kits/assign-auto`, {
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
                setStatus(data.message || 'Kunne ikke tildele trøje');
                return;
            }
            setStatus(`Tildelt ${pinJersey.name} til ${pinClub} (auto)`);
            setPinNotes('');
            await loadOverview();
        } finally {
            setBusy(false);
        }
    };

    const resetProposed = () => {
        setIgnoreProposed(true);
        setStatus('Forslag nulstillet. Viser kun gemte trøjer — andre klubber er uændrede.');
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
            setStatus('Auto-tildeling gemt (eksisterende kits uændrede, kun manglende klubber)');
            setIgnoreProposed(false);
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
            setStatus(
                `Levels opdateret: ${data.updated}/${data.total} (skip ${data.skipped}, fail ${data.failed}). Gemte klubtrøjer er uændrede.`,
            );
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
                        Level-auto og working P-koder danner puljen. P-koder tæller kun for ryttere, der sidst har kørt Zwift på PC/Mac.
                        Ukendt rytter-level tælles som 1 (starttrøjer alle har). En pinnet trøje er kun til den klub og tildeles aldrig automatisk til andre.
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
                        onClick={resetProposed}
                        disabled={busy}
                        className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-secondary/50 disabled:opacity-50"
                    >
                        Nulstil forslag
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
            {previewDiffers && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                    Foreslået auto-tildeling afviger fra det gemte — kun klubber uden gemt trøje.
                    Min Profil og Info bruger stadig de gemte trøjer. Brug Tildel som auto til nye klubber,
                    eller Nulstil forslag for at skjule dette.
                </p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Ryttere med level" value={`${overview?.riders.knownDropLevel ?? 0}/${overview?.riders.total ?? 0}`} />
                <Stat
                    label="Dækning (gemt)"
                    value={
                        savedCoverage.missingCount
                            ? `${savedCoverage.percent}% · ${savedCoverage.missingCount} mangler`
                            : `${savedCoverage.percent}%`
                    }
                />
                <Stat
                    label="Rytterdækning (level/kode)"
                    value={
                        overview?.riderCoverage
                            ? `${overview.riderCoverage.percent}% · ${overview.riderCoverage.canObtain}/${overview.riderCoverage.total}`
                            : '—'
                    }
                />
                <Stat label="Pinned / auto (gemt)" value={`${savedCoverage.pinnedCount} / ${savedCoverage.autoCount}`} />
                <Stat label="Unikke auto / doubles (gemt)" value={`${savedCoverage.uniqueAuto} / ${savedCoverage.sharedJerseyCount}`} />
            </div>
            {previewDiffers && coverage && (
                <p className="text-xs text-muted-foreground">
                    Foreslået efter nuværende levels: {coverage.percent}% klubdækning
                    {overview?.preview.riderCoverage
                        ? `, ${overview.preview.riderCoverage.percent}% rytterdækning (${overview.preview.riderCoverage.canObtain}/${overview.preview.riderCoverage.total})`
                        : ''}
                    , {coverage.pinnedCount} pinned / {coverage.autoCount} auto,
                    {' '}{coverage.uniqueAuto} unikke / {coverage.sharedJerseyCount} doubles.
                </p>
            )}

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
                                <th className="p-2 text-left">
                                    <SortButton
                                        label="Trøje"
                                        active={jerseySort.key === 'name'}
                                        dir={jerseySort.dir}
                                        onClick={() => setJerseySort((prev) => ({
                                            key: 'name',
                                            dir: prev.key === 'name' && prev.dir === 'asc' ? 'desc' : 'asc',
                                        }))}
                                    />
                                </th>
                                <th className="p-2 text-left">
                                    <SortButton
                                        label="Level"
                                        active={jerseySort.key === 'level'}
                                        dir={jerseySort.dir}
                                        onClick={() => setJerseySort((prev) => ({
                                            key: 'level',
                                            dir: prev.key === 'level' && prev.dir === 'asc' ? 'desc' : 'asc',
                                        }))}
                                    />
                                </th>
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
                <h3 className="font-semibold">Tildel klubtrøje</h3>
                <p className="text-xs text-muted-foreground">
                    Vælg en trøje i søgningen ovenfor. Tildel som auto gemmer kun den klub og rører ikke de andre.
                    Pin er eksklusiv og fjerner auto-kopier af samme trøje.
                    P-kode-trøjer kan kun tildeles, hvis ryttere uden level-grant sidst har kørt Zwift på PC/Mac.
                </p>
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
                    <p className="text-sm self-center">
                        {pinJersey ? `Valgt: ${pinJersey.name}` : 'Vælg en trøje i søgningen'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => void assignAutoSelected()}
                        disabled={busy || !pinClub || !pinJersey}
                        className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
                    >
                        Tildel som auto
                    </button>
                    <button
                        type="button"
                        onClick={() => void pinSelected()}
                        disabled={busy || !pinClub || !pinJersey}
                        className="px-3 py-2 text-sm border border-border rounded-lg disabled:opacity-50"
                    >
                        Pin
                    </button>
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="font-semibold">Klubber og tildeling</h3>
                {missingClubs.length > 0 && (
                    <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm space-y-1">
                        <p className="font-medium text-amber-900 dark:text-amber-200">
                            Mangler gemt trøje ({missingClubs.length})
                        </p>
                        {missingClubs.map((club) => (
                            <p key={club.club} className="text-amber-800 dark:text-amber-300">
                                {club.club}
                                {' · '}
                                {club.memberCount} {club.memberCount === 1 ? 'medlem' : 'medlemmer'}
                                {' · pool '}
                                {club.poolSize}
                                {emptyReasonByClub.get(club.club)
                                    ? ` · ${emptyReasonByClub.get(club.club)}`
                                    : club.kit?.jerseyName
                                        ? ` · foreslået: ${club.kit.jerseyName}`
                                        : ''}
                            </p>
                        ))}
                    </div>
                )}
                {clubsBlockedFromCode.length > 0 && (
                    <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm space-y-2">
                        <p className="font-medium text-amber-900 dark:text-amber-200">
                            P-kode kræver PC/Mac ({clubsBlockedFromCode.length} klubber)
                        </p>
                        {clubsBlockedFromCode.map((club) => (
                            <div key={club.club} className="text-amber-800 dark:text-amber-300">
                                <p>
                                    {club.club}: {club.cannotEnterCodeCount} ryttere kan ikke indtaste koden
                                    {savedByClub.get(club.club)?.jerseyName
                                        ? ` (${savedByClub.get(club.club)?.jerseyName})`
                                        : ''}
                                </p>
                                <p className="text-xs pl-2">
                                    {(club.cannotEnterCode || []).map((rider) => (
                                        `${rider.name || 'Ukendt'} (${platformLabel(rider.gameClientPlatform)})`
                                    )).join(', ')}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
                {clubsBelowKitLevel.length > 0 && (
                    <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm space-y-2">
                        <p className="font-medium text-amber-900 dark:text-amber-200">
                            Ryttere under klubtrøjenens level ({clubsBelowKitLevel.length} klubber)
                        </p>
                        {clubsBelowKitLevel.map((club) => (
                            <div key={club.club} className="text-amber-800 dark:text-amber-300">
                                <p>
                                    {club.club}: {club.belowKitLevelCount} under level {club.kitMinLevel}
                                    {savedByClub.get(club.club)?.jerseyName
                                        ? ` (${savedByClub.get(club.club)?.jerseyName})`
                                        : ''}
                                </p>
                                <p className="text-xs pl-2">
                                    {(club.belowKitLevel || []).map((rider) => (
                                        `${rider.name || 'Ukendt'} (level ${rider.dropLevel ?? '?'})`
                                    )).join(', ')}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
                <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="p-2 text-left">Klub</th>
                                <th className="p-2 text-left">Medlemmer</th>
                                <th className="p-2 text-left">Levels</th>
                                <th className="p-2 text-left">
                                    <SortButton
                                        label="Min. level"
                                        active={clubSort.key === 'minLevel'}
                                        dir={clubSort.dir}
                                        onClick={() => setClubSort((prev) => ({
                                            key: 'minLevel',
                                            dir: prev.key === 'minLevel' && prev.dir === 'asc' ? 'desc' : 'asc',
                                        }))}
                                    />
                                </th>
                                <th className="p-2 text-left">Har level</th>
                                <th className="p-2 text-left">PC/Mac</th>
                                <th className="p-2 text-left">Trøje</th>
                                <th className="p-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {sortedClubs.map((club) => {
                                const saved = savedByClub.get(club.club);
                                const proposed = club.kit;
                                const savedSig = saved?.jerseySignature ?? null;
                                const proposedSig = proposed?.jerseySignature ?? null;
                                const proposedDiffers = savedSig !== proposedSig;
                                const missing = savedSig == null;
                                return (
                                <tr
                                    key={club.club}
                                    className={`border-t border-border ${missing ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}
                                >
                                    <td className="p-2">{club.club}</td>
                                    <td className="p-2">{club.memberCount}</td>
                                    <td className="p-2">{club.knownLevels}/{club.memberCount}</td>
                                    <td className="p-2">{club.minDropLevel ?? '—'}</td>
                                    <td className={`p-2 ${
                                        club.atKitLevelCount != null
                                        && club.atKitLevelCount < club.memberCount
                                            ? 'text-amber-700 dark:text-amber-400'
                                            : ''
                                    }`}>
                                        {club.atKitLevelCount != null
                                            ? `${club.atKitLevelCount}/${club.memberCount}`
                                            : '—'}
                                    </td>
                                    <td className={`p-2 ${
                                        (club.pcMacCount || 0) < club.memberCount
                                            ? 'text-amber-700 dark:text-amber-400'
                                            : ''
                                    }`}>
                                        {`${club.pcMacCount ?? 0}/${club.memberCount}`}
                                    </td>
                                    <td className="p-2">
                                        <div className="flex items-center gap-2">
                                            {jerseyThumb(saved?.imageUrl, saved?.jerseyName)}
                                            <span>
                                                {saved?.jerseyName || '—'}
                                                {saved?.assignment === 'pinned' ? ' (pinned)' : saved ? ' (auto)' : ''}
                                                {savedSig != null
                                                    ? ` · ${clubCountLabel(jerseyClubCount[savedSig] || 0)}`
                                                    : ''}
                                            </span>
                                        </div>
                                        {proposedDiffers && !ignoreProposed && (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Foreslået: {proposed?.jerseyName || 'ingen'}
                                            </p>
                                        )}
                                        {(club.belowKitLevelCount || 0) > 0 && (
                                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                                {club.belowKitLevelCount} ryttere under level {club.kitMinLevel}
                                            </p>
                                        )}
                                        {(club.cannotEnterCodeCount || 0) > 0 && (
                                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                                {club.cannotEnterCodeCount} ryttere kan ikke indtaste P-kode
                                            </p>
                                        )}
                                    </td>
                                    <td className="p-2 text-right">
                                        {saved?.assignment === 'pinned' && (
                                            <button type="button" className="text-xs text-muted-foreground" onClick={() => void unpinClub(club.club)}>
                                                Unpin
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {(overview?.preview.emptyPools || [])
                    .filter((row) => savedByClub.get(row.club)?.jerseySignature != null)
                    .map((row) => (
                        <p key={row.club} className="text-sm text-muted-foreground">
                            {row.club}: gemt trøje, men foreslået pulje er tom ({row.reason})
                        </p>
                    ))}
            </section>
        </div>
    );
}

function SortButton({
    label,
    active,
    dir,
    onClick,
}: {
    label: string;
    active: boolean;
    dir: 'asc' | 'desc';
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1 font-medium hover:text-foreground"
            aria-label={`Sortér efter ${label}`}
        >
            {label}
            <span className={`text-xs ${active ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
        </button>
    );
}

function clubCountLabel(count: number): string {
    return count === 1 ? '1 klub' : `${count} klubber`;
}

function platformLabel(platform?: string | null): string {
    const labels: Record<string, string> = {
        windows: 'Windows',
        mac: 'Mac',
        ios: 'iOS',
        android: 'Android',
        tvos: 'Apple TV',
        unknown: 'ukendt',
    };
    const key = (platform || 'unknown').toLowerCase();
    return labels[key] || platform || 'ukendt';
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-3 border border-border rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
        </div>
    );
}
