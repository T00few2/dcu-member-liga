'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface UserRow {
    zwiftId: string;
    name: string;
    email: string;
    club: string;
    trainer: string;
    category: string;
    categoryLocked: boolean;
    zwiftConnected: boolean;
    stravaConnected: boolean;
    verificationStatus: string;
    currentRating: number | string;
    max30Rating: number | string;
    phenotype: string;
    signedUpAt: number | null;
}

type SortKey = keyof UserRow;
type SortDir = 'asc' | 'desc';

const CATEGORY_STYLES: Record<string, string> = {
    Diamond:  'bg-cyan-100 text-cyan-800',
    Ruby:     'bg-red-100 text-red-800',
    Emerald:  'bg-green-100 text-green-800',
    Sapphire: 'bg-blue-100 text-blue-800',
    Amethyst: 'bg-purple-100 text-purple-800',
    Platinum: 'bg-slate-100 text-slate-700',
    Gold:     'bg-yellow-100 text-yellow-800',
    Silver:   'bg-gray-100 text-gray-700',
    Bronze:   'bg-orange-100 text-orange-800',
    Copper:   'bg-amber-100 text-amber-800',
};

const VERIFICATION_STYLES: Record<string, string> = {
    approved:  'bg-green-100 text-green-800',
    submitted: 'bg-blue-100 text-blue-800',
    pending:   'bg-yellow-100 text-yellow-800',
    rejected:  'bg-red-100 text-red-800',
    none:      'bg-gray-100 text-gray-600',
};

function Badge({ label, className }: { label: string; className: string }) {
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
            {label}
        </span>
    );
}

function ConnDot({ ok, title }: { ok: boolean; title: string }) {
    return (
        <span
            title={title}
            className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-300'}`}
        />
    );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
    if (!active) return <span className="ml-1 text-muted-foreground opacity-30">↕</span>;
    return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export default function UsersOverview() {
    const { user } = useAuth();
    const [rows, setRows] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('club');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    const fetchUsers = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setError(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/users`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setRows(data.users ?? []);
        } catch (e: any) {
            setError(e.message ?? 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const base = q
            ? rows.filter(r =>
                r.name.toLowerCase().includes(q) ||
                r.email.toLowerCase().includes(q) ||
                r.club.toLowerCase().includes(q) ||
                r.zwiftId.toLowerCase().includes(q) ||
                r.trainer.toLowerCase().includes(q) ||
                r.category.toLowerCase().includes(q)
            )
            : rows;

        return [...base].sort((a, b) => {
            let av = a[sortKey] ?? '';
            let bv = b[sortKey] ?? '';
            if (typeof av === 'number' && typeof bv === 'number') {
                return sortDir === 'asc' ? av - bv : bv - av;
            }
            av = String(av).toLowerCase();
            bv = String(bv).toLowerCase();
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [rows, search, sortKey, sortDir]);

    const handleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    };

    const Th = ({ label, k }: { label: string; k: SortKey }) => (
        <th
            className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition"
            onClick={() => handleSort(k)}
        >
            {label}<SortIcon active={sortKey === k} dir={sortDir} />
        </th>
    );

    if (loading) return (
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading users…</div>
    );

    if (error) return (
        <div className="flex flex-col items-center gap-4 py-20">
            <p className="text-red-600 font-medium">Error: {error}</p>
            <button onClick={fetchUsers} className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 text-sm font-medium">Retry</button>
        </div>
    );

    return (
        <div className="space-y-4 pb-12">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        placeholder="Search name, email, club, Zwift ID…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-72"
                    />
                    <span className="text-sm text-muted-foreground">{filtered.length} / {rows.length} riders</span>
                </div>
                <button
                    onClick={fetchUsers}
                    className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition"
                >
                    Refresh
                </button>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-border overflow-x-auto shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-muted border-b border-border">
                        <tr>
                            <Th label="Zwift ID"   k="zwiftId" />
                            <Th label="Name"       k="name" />
                            <Th label="Email"      k="email" />
                            <Th label="Club"       k="club" />
                            <Th label="Trainer"    k="trainer" />
                            <Th label="Kategori"   k="category" />
                            <Th label="vELO (30d)" k="max30Rating" />
                            <Th label="Phenotype"  k="phenotype" />
                            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Connections</th>
                            <Th label="Verification" k="verificationStatus" />
                            <Th label="Signed up"  k="signedUpAt" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                                    No users found.
                                </td>
                            </tr>
                        )}
                        {filtered.map(row => (
                            <tr key={row.zwiftId} className="bg-card hover:bg-muted/50 transition">
                                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.zwiftId}</td>
                                <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{row.name}</td>
                                <td className="px-3 py-2 text-muted-foreground text-xs">{row.email}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{row.club}</td>
                                <td className="px-3 py-2 text-muted-foreground">{row.trainer || '—'}</td>
                                <td className="px-3 py-2">
                                    {row.category ? (
                                        <Badge
                                            label={row.category}
                                            className={CATEGORY_STYLES[row.category] ?? 'bg-gray-100 text-gray-700'}
                                        />
                                    ) : <span className="text-muted-foreground">—</span>}
                                    {row.categoryLocked && (
                                        <span className="ml-1 text-xs text-muted-foreground" title="Locked after first race">🔒</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-xs">
                                    {row.max30Rating !== '' && row.max30Rating !== 'N/A' ? Number(row.max30Rating).toFixed(0) : '—'}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground capitalize">{row.phenotype || '—'}</td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <ConnDot ok={row.zwiftConnected}  title={row.zwiftConnected  ? 'Zwift connected'  : 'Zwift not connected'} />
                                        <span className="text-xs text-muted-foreground">Z</span>
                                        <ConnDot ok={row.stravaConnected} title={row.stravaConnected ? 'Strava connected' : 'Strava not connected'} />
                                        <span className="text-xs text-muted-foreground">S</span>
                                    </div>
                                </td>
                                <td className="px-3 py-2">
                                    <Badge
                                        label={row.verificationStatus}
                                        className={VERIFICATION_STYLES[row.verificationStatus] ?? 'bg-gray-100 text-gray-600'}
                                    />
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                                    {row.signedUpAt
                                        ? new Date(row.signedUpAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })
                                        : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
