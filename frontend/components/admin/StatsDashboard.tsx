'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';

// ── Category colour mapping (matches ZwiftRacing tier colours) ────────────────
const CATEGORY_COLORS: Record<string, string> = {
    Diamond:  '#b9f2ff',
    Ruby:     '#e0115f',
    Emerald:  '#50c878',
    Sapphire: '#0f52ba',
    Amethyst: '#9966cc',
    Platinum: '#a0a0a0',
    Gold:     '#ffd700',
    Silver:   '#c0c0c0',
    Bronze:   '#cd7f32',
    Copper:   '#b87333',
    Unassigned: '#6b7280',
};

const CHART_PALETTE = [
    '#c00418', '#122f3b', '#e8a838', '#4a7c59',
    '#7c3aed', '#0891b2', '#dc2626', '#059669',
    '#d97706', '#6366f1', '#db2777', '#0d9488',
];

interface StatsData {
    total: number;
    clubCount: number;
    lockedCount: number;
    selfSelectedCount: number;
    leagueName?: string;
    seasonStart?: string;
    registrationStatus: { status: string; count: number }[];
    categoryDistribution: { category: string; count: number }[];
    clubDistribution: { club: string; count: number }[];
    trainerDistribution: { trainer: string; count: number }[];
    verificationStatus: { status: string; count: number }[];
    phenotypeDistribution: { phenotype: string; count: number }[];
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="bg-card rounded-xl border border-border p-5 flex flex-col gap-1 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
            <span className="text-4xl font-bold text-foreground">{value}</span>
            {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h2 className="text-lg font-semibold text-foreground mb-4">{children}</h2>
    );
}

const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft',
    complete: 'Complete',
    none: 'None',
    pending: 'Pending',
    submitted: 'Submitted',
    approved: 'Approved',
    rejected: 'Rejected',
};

const STATUS_COLORS: Record<string, string> = {
    complete:  '#059669',
    draft:     '#d97706',
    approved:  '#059669',
    submitted: '#0891b2',
    pending:   '#d97706',
    rejected:  '#dc2626',
    none:      '#6b7280',
};

// Custom tooltip for recharts
function ChartTip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow text-sm">
            <p className="font-medium text-foreground mb-1">{label}</p>
            {payload.map((p: any) => (
                <p key={p.dataKey} style={{ color: p.fill || p.color }}>
                    {p.name ?? p.dataKey}: <strong>{p.value}</strong>
                </p>
            ))}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsDashboard() {
    const { user } = useAuth();
    const [stats, setStats] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setError(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/stats`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setStats(await res.json());
        } catch (e: any) {
            setError(e.message ?? 'Failed to load stats');
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { fetchStats(); }, [fetchStats]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
                Loading stats…
            </div>
        );
    }

    if (error || !stats) {
        return (
            <div className="flex flex-col items-center gap-4 py-20">
                <p className="text-destructive-foreground font-medium">Error: {error}</p>
                <button
                    onClick={fetchStats}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 text-sm font-medium"
                >
                    Retry
                </button>
            </div>
        );
    }

    const completeCount = stats.registrationStatus.find(s => s.status === 'complete')?.count ?? 0;
    const completePct = stats.total > 0 ? Math.round((completeCount / stats.total) * 100) : 0;

    // Limit club chart to top 15 for readability
    const topClubs = stats.clubDistribution.slice(0, 15);

    return (
        <div className="space-y-10 pb-12">

            {/* Header row */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-foreground">
                        {stats.leagueName ?? 'League'} — Overview
                    </h2>
                    {stats.seasonStart && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Season started {new Date(stats.seasonStart).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                    )}
                </div>
                <button
                    onClick={fetchStats}
                    className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition"
                >
                    Refresh
                </button>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <StatCard label="Total Signups" value={stats.total} />
                <StatCard label="Completed" value={completeCount} sub={`${completePct}% of signups`} />
                <StatCard label="Clubs" value={stats.clubCount} />
                <StatCard
                    label="Kategori Assigned"
                    value={stats.total - (stats.categoryDistribution.find(c => c.category === 'Unassigned')?.count ?? 0)}
                    sub="riders with a category"
                />
                <StatCard label="Race-Locked" value={stats.lockedCount} sub="locked after first race" />
            </div>

            {/* ── Kategori Distribution ── */}
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
                <SectionTitle>Kategori Distribution</SectionTitle>
                {stats.categoryDistribution.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No category data yet.</p>
                ) : (
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={stats.categoryDistribution} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="category" tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }} />
                            <YAxis allowDecimals={false} tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="count" name="Riders" radius={[4, 4, 0, 0]}>
                                {stats.categoryDistribution.map((entry) => (
                                    <Cell
                                        key={entry.category}
                                        fill={CATEGORY_COLORS[entry.category] ?? '#6b7280'}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* ── Clubs + Registration status ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Club distribution (bar, takes 2/3) */}
                <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6 shadow-sm">
                    <SectionTitle>Club Distribution {topClubs.length < stats.clubDistribution.length && `(top ${topClubs.length})`}</SectionTitle>
                    {topClubs.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No club data yet.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={Math.max(260, topClubs.length * 28)}>
                            <BarChart
                                layout="vertical"
                                data={topClubs}
                                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }} />
                                <YAxis
                                    type="category"
                                    dataKey="club"
                                    width={130}
                                    tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
                                />
                                <Tooltip content={<ChartTip />} />
                                <Bar dataKey="count" name="Riders" fill="#122f3b" radius={[0, 4, 4, 0]}>
                                    {topClubs.map((entry, i) => (
                                        <Cell key={entry.club} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Registration status (pie, takes 1/3) */}
                <div className="bg-card rounded-xl border border-border p-6 shadow-sm flex flex-col">
                    <SectionTitle>Registration Status</SectionTitle>
                    {stats.registrationStatus.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No data yet.</p>
                    ) : (
                        <>
                            <ResponsiveContainer width="100%" height={180}>
                                <PieChart>
                                    <Pie
                                        data={stats.registrationStatus}
                                        dataKey="count"
                                        nameKey="status"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={70}
                                        innerRadius={34}
                                        paddingAngle={2}
                                    >
                                        {stats.registrationStatus.map((entry) => (
                                            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#6b7280'} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value, name) => [value, STATUS_LABELS[name as string] ?? name]} />
                                </PieChart>
                            </ResponsiveContainer>
                            <ul className="mt-3 space-y-1.5">
                                {stats.registrationStatus.map(({ status, count }) => (
                                    <li key={status} className="flex items-center gap-2 text-sm">
                                        <span
                                            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ background: STATUS_COLORS[status] ?? '#6b7280' }}
                                        />
                                        <span className="text-muted-foreground flex-1">{STATUS_LABELS[status] ?? status}</span>
                                        <span className="font-semibold text-foreground">{count}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            </div>

            {/* ── Trainer + Phenotype + Verification ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Trainer types */}
                <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
                    <SectionTitle>Trainer Types</SectionTitle>
                    {stats.trainerDistribution.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No data yet.</p>
                    ) : (
                        <ul className="space-y-2">
                            {stats.trainerDistribution.map(({ trainer, count }, i) => (
                                <li key={trainer} className="flex items-center gap-2">
                                    <div
                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                        style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }}
                                    />
                                    <span className="text-sm text-muted-foreground flex-1 truncate" title={trainer}>{trainer}</span>
                                    <span className="text-sm font-semibold text-foreground">{count}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Phenotype distribution */}
                <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
                    <SectionTitle>Rider Phenotypes</SectionTitle>
                    {stats.phenotypeDistribution.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No phenotype data yet.</p>
                    ) : (
                        <>
                            <ResponsiveContainer width="100%" height={160}>
                                <PieChart>
                                    <Pie
                                        data={stats.phenotypeDistribution}
                                        dataKey="count"
                                        nameKey="phenotype"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={65}
                                        innerRadius={28}
                                        paddingAngle={2}
                                    >
                                        {stats.phenotypeDistribution.map((_, i) => (
                                            <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </>
                    )}
                </div>

                {/* Verification status */}
                <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
                    <SectionTitle>Verification Status</SectionTitle>
                    {stats.verificationStatus.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No data yet.</p>
                    ) : (
                        <ul className="space-y-2">
                            {stats.verificationStatus.map(({ status, count }) => (
                                <li key={status} className="flex items-center gap-2">
                                    <div
                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                        style={{ background: STATUS_COLORS[status] ?? '#6b7280' }}
                                    />
                                    <span className="text-sm text-muted-foreground flex-1">{STATUS_LABELS[status] ?? status}</span>
                                    <span className="text-sm font-semibold text-foreground">{count}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

        </div>
    );
}
