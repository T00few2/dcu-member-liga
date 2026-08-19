'use client';

import { useState } from 'react';
import { useAdminStatsQuery } from '@/hooks/queries';
import type { DualRecordingBucket, StatsData } from '@/hooks/queries';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
    LineChart, Line,
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

// ── Dual recording ────────────────────────────────────────────────────────────
const DR_BUCKETS: DualRecordingBucket[] = ['required', 'notRequired', 'unknown'];

const DR_LABELS: Record<DualRecordingBucket, string> = {
    required: 'Dual recording required',
    notRequired: 'No dual recording',
    unknown: 'Unknown trainer',
};

const DR_SHORT_LABELS: Record<DualRecordingBucket, string> = {
    required: 'Dual',
    notRequired: 'No dual',
    unknown: 'Unknown',
};

const DR_COLORS: Record<DualRecordingBucket, string> = {
    required: '#c00418',
    notRequired: '#059669',
    unknown: '#6b7280',
};

const ALL_CATEGORIES = '__all__';

function pct(value: number, total: number) {
    return total > 0 ? Math.round((value / total) * 100) : 0;
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
    const statsQuery = useAdminStatsQuery();

    if (statsQuery.isLoading) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
                Loading stats…
            </div>
        );
    }

    if (statsQuery.isError || !statsQuery.data) {
        return (
            <div className="flex flex-col items-center gap-4 py-20">
                <p className="text-destructive-foreground font-medium">
                    Error: {statsQuery.error instanceof Error ? statsQuery.error.message : 'Failed to load stats'}
                </p>
                <button
                    onClick={() => statsQuery.refetch()}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 text-sm font-medium"
                >
                    Retry
                </button>
            </div>
        );
    }

    const stats = statsQuery.data;

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
                    onClick={() => statsQuery.refetch()}
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

            {/* ── Signup Growth ── */}
            {stats.growthSeries.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
                    <SectionTitle>Signup Growth Over Time</SectionTitle>
                    <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={stats.growthSeries} margin={{ top: 4, right: 40, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis
                                dataKey="date"
                                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
                                tickFormatter={(d) => {
                                    const [, m, day] = d.split('-');
                                    return `${day}/${m}`;
                                }}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                yAxisId="signups"
                                allowDecimals={false}
                                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
                                label={{ value: 'Signups', angle: -90, position: 'insideLeft', offset: 10, style: { fill: 'var(--color-muted-foreground)', fontSize: 11 } }}
                            />
                            <YAxis
                                yAxisId="clubs"
                                orientation="right"
                                allowDecimals={false}
                                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
                                label={{ value: 'Clubs', angle: 90, position: 'insideRight', offset: 10, style: { fill: 'var(--color-muted-foreground)', fontSize: 11 } }}
                            />
                            <Tooltip content={<ChartTip />} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Line
                                yAxisId="signups"
                                type="monotone"
                                dataKey="signups"
                                name="Completed Signups"
                                stroke="#c00418"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4 }}
                            />
                            <Line
                                yAxisId="clubs"
                                type="monotone"
                                dataKey="clubs"
                                name="Unique Clubs"
                                stroke="#122f3b"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

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

            {/* ── Trainer types & dual recording ── */}
            <TrainerAnalysis stats={stats} />

            {/* ── Phenotype + Verification ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

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

// ── Trainer analysis (per kategori + dual recording) ──────────────────────────

function DualTip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow text-sm">
            <p className="font-medium text-foreground mb-1">{label}</p>
            {DR_BUCKETS.map(bucket => (
                <p key={bucket} style={{ color: DR_COLORS[bucket] }}>
                    {DR_LABELS[bucket]}: <strong>{row[bucket]}</strong> ({pct(row[bucket], row.total)}%)
                </p>
            ))}
            <p className="text-muted-foreground mt-1">Riders: {row.total}</p>
        </div>
    );
}

function TrainerAnalysis({ stats }: { stats: StatsData }) {
    const [category, setCategory] = useState<string>(ALL_CATEGORIES);
    const [mode, setMode] = useState<'count' | 'percent'>('count');

    const trainerByCategory = stats.trainerByCategory ?? [];
    const dualByCategory = stats.dualRecordingByCategory ?? [];
    const categories = stats.categoryDistribution.map(c => c.category);
    const isAll = category === ALL_CATEGORIES;
    const scopeLabel = isAll ? 'all kategorier' : category;

    const trainers = isAll
        ? (stats.trainerDistribution ?? [])
        : (trainerByCategory.find(c => c.category === category)?.trainers ?? []);
    const maxTrainerCount = trainers.reduce((max, t) => Math.max(max, t.count), 0);
    const trainerTotal = trainers.reduce((sum, t) => sum + t.count, 0);

    // Dual-recording counts for the selected scope
    const scopeRow = dualByCategory.find(d => d.category === category);
    const scopeCounts: Record<DualRecordingBucket, number> = isAll
        ? {
            required: (stats.dualRecordingDistribution ?? []).find(d => d.bucket === 'required')?.count ?? 0,
            notRequired: (stats.dualRecordingDistribution ?? []).find(d => d.bucket === 'notRequired')?.count ?? 0,
            unknown: (stats.dualRecordingDistribution ?? []).find(d => d.bucket === 'unknown')?.count ?? 0,
        }
        : {
            required: scopeRow?.required ?? 0,
            notRequired: scopeRow?.notRequired ?? 0,
            unknown: scopeRow?.unknown ?? 0,
        };
    const scopeTotal = DR_BUCKETS.reduce((sum, bucket) => sum + scopeCounts[bucket], 0);
    const donutData = DR_BUCKETS
        .map(bucket => ({ bucket, name: DR_LABELS[bucket], count: scopeCounts[bucket] }))
        .filter(d => d.count > 0);

    // Percentages are kept unrounded for the bars so stacks always reach 100%;
    // the tooltip rounds off the raw counts instead.
    const chartData = dualByCategory.map(row => ({
        category: row.category,
        total: row.total,
        required: row.required,
        notRequired: row.notRequired,
        unknown: row.unknown,
        requiredPct: row.total > 0 ? (row.required / row.total) * 100 : 0,
        notRequiredPct: row.total > 0 ? (row.notRequired / row.total) * 100 : 0,
        unknownPct: row.total > 0 ? (row.unknown / row.total) * 100 : 0,
    }));
    const percentMode = mode === 'percent';

    // An older /admin/stats deployment returns trainer counts without the
    // dual-recording breakdown; say so instead of claiming there is no data.
    const dualDataMissing = trainerTotal > 0 && scopeTotal === 0;
    const emptyDualMessage = dualDataMissing
        ? 'Dual recording data is not in this stats response yet — hit Refresh to reload it.'
        : 'No trainer data for this kategori.';

    return (
        <div className="space-y-6">

            {/* Scope selector */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-foreground">Trainer Analysis</h2>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Kategori
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
                    >
                        <option value={ALL_CATEGORIES}>All kategorier</option>
                        {categories.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

                {/* Trainer types for the selected kategori */}
                <div className="lg:col-span-3 bg-card rounded-xl border border-border p-6 shadow-sm">
                    <div className="flex items-baseline justify-between mb-4">
                        <h3 className="text-lg font-semibold text-foreground">Trainer Types</h3>
                        <span className="text-sm text-muted-foreground">
                            {scopeLabel} · {trainers.length} models
                        </span>
                    </div>
                    {trainers.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No trainer data for this kategori.</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                                {DR_BUCKETS.map(bucket => (
                                    <span key={bucket} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <span
                                            className="inline-block w-2.5 h-2.5 rounded-full"
                                            style={{ background: DR_COLORS[bucket] }}
                                        />
                                        {DR_LABELS[bucket]}
                                    </span>
                                ))}
                            </div>
                            <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                                {trainers.map(({ trainer, count, dualRecording }) => {
                                    const bucket: DualRecordingBucket = dualRecording ?? 'unknown';
                                    return (
                                        <li key={trainer} className="flex items-center gap-2">
                                            <div
                                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                style={{ background: DR_COLORS[bucket] }}
                                                title={DR_LABELS[bucket]}
                                            />
                                            <span className="text-sm text-muted-foreground flex-1 truncate" title={trainer}>
                                                {trainer}
                                            </span>
                                            <span className="hidden sm:block w-32 h-1.5 rounded-full bg-border overflow-hidden">
                                                <span
                                                    className="block h-full rounded-full"
                                                    style={{
                                                        width: `${maxTrainerCount > 0 ? (count / maxTrainerCount) * 100 : 0}%`,
                                                        background: DR_COLORS[bucket],
                                                    }}
                                                />
                                            </span>
                                            <span className="text-sm font-semibold text-foreground w-8 text-right">{count}</span>
                                            <span className="text-xs text-muted-foreground w-10 text-right">
                                                {pct(count, trainerTotal)}%
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                </div>

                {/* Dual recording split for the selected kategori */}
                <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6 shadow-sm flex flex-col">
                    <div className="flex items-baseline justify-between mb-4">
                        <h3 className="text-lg font-semibold text-foreground">Dual Recording</h3>
                        <span className="text-sm text-muted-foreground">{scopeLabel}</span>
                    </div>
                    {scopeTotal === 0 ? (
                        <p className="text-muted-foreground text-sm">{emptyDualMessage}</p>
                    ) : (
                        <>
                            <ResponsiveContainer width="100%" height={180}>
                                <PieChart>
                                    <Pie
                                        data={donutData}
                                        dataKey="count"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={70}
                                        innerRadius={34}
                                        paddingAngle={2}
                                    >
                                        {donutData.map(entry => (
                                            <Cell key={entry.bucket} fill={DR_COLORS[entry.bucket]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value, name) => [`${value} (${pct(Number(value), scopeTotal)}%)`, name]} />
                                </PieChart>
                            </ResponsiveContainer>
                            <ul className="mt-3 space-y-1.5">
                                {DR_BUCKETS.map(bucket => (
                                    <li key={bucket} className="flex items-center gap-2 text-sm">
                                        <span
                                            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ background: DR_COLORS[bucket] }}
                                        />
                                        <span className="text-muted-foreground flex-1">{DR_LABELS[bucket]}</span>
                                        <span className="font-semibold text-foreground">{scopeCounts[bucket]}</span>
                                        <span className="text-xs text-muted-foreground w-10 text-right">
                                            {pct(scopeCounts[bucket], scopeTotal)}%
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <p className="text-xs text-muted-foreground mt-3">
                                Riders with no registered trainer — or a trainer that is no longer in the
                                trainer catalog — are counted as unknown.
                            </p>
                        </>
                    )}
                </div>
            </div>

            {/* Dual recording split across all kategorier */}
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Dual Recording by Kategori</h3>
                    <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                        {(['count', 'percent'] as const).map(m => (
                            <button
                                key={m}
                                onClick={() => setMode(m)}
                                className={`px-3 py-1.5 transition ${
                                    mode === m
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {m === 'count' ? 'Riders' : 'Share'}
                            </button>
                        ))}
                    </div>
                </div>
                {chartData.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{emptyDualMessage}</p>
                ) : (
                    <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="category" tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }} />
                            <YAxis
                                allowDecimals={false}
                                domain={percentMode ? [0, 100] : undefined}
                                tickFormatter={percentMode ? (v) => `${v}%` : undefined}
                                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                            />
                            <Tooltip content={<DualTip />} cursor={{ fill: 'var(--color-border)', opacity: 0.3 }} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            {DR_BUCKETS.map(bucket => (
                                <Bar
                                    key={bucket}
                                    dataKey={percentMode ? `${bucket}Pct` : bucket}
                                    name={DR_SHORT_LABELS[bucket]}
                                    stackId="dr"
                                    fill={DR_COLORS[bucket]}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
