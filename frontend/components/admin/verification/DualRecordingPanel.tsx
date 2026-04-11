'use client';

import { useEffect, useRef, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, LineChart, Line, ReferenceLine, ReferenceArea,
} from 'recharts';
import type { ZwiftActivity, StravaMatchActivity, DualRecordingResult, CpDiffRow } from '@/hooks/useDualRecording';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
}

function fmtDuration(sec: number | null | undefined) {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

function fmtOffset(sec: number) {
    if (sec === 0) return 'simultaneous';
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    const label = m > 0 ? `${m}m ${s}s` : `${s}s`;
    return sec > 0
        ? `Strava started ${label} before Zwift`
        : `Strava started ${label} after Zwift`;
}

/** Colour-code a % difference. */
function diffColour(pct: number | null | undefined): string {
    if (pct == null) return 'text-muted-foreground';
    const abs = Math.abs(pct);
    if (abs <= 3) return 'text-green-600';
    if (abs <= 8) return 'text-yellow-600';
    return 'text-red-600';
}

function diffBadge(pct: number | null | undefined) {
    if (pct == null) return <span className="text-muted-foreground">—</span>;
    const colour = diffColour(pct);
    const sign = pct >= 0 ? '+' : '';
    return <span className={`font-mono font-bold ${colour}`}>{sign}{pct.toFixed(1)}%</span>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SyncBadge({ offsetSec }: { offsetSec: number }) {
    return (
        <span className="text-xs text-muted-foreground italic">
            {fmtOffset(offsetSec)}
        </span>
    );
}

function StatsTable({ result }: { result: DualRecordingResult }) {
    const { comparison, sync } = result;
    if (!comparison) return null;
    const { cpDiff, avgPower } = comparison;

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr className="bg-muted/40 text-muted-foreground text-xs uppercase">
                        <th className="p-2 text-left">Duration</th>
                        <th className="p-2 text-right">Zwift (W)</th>
                        <th className="p-2 text-right">Strava (W)</th>
                        <th className="p-2 text-right">Diff (W)</th>
                        <th className="p-2 text-right">Diff (%)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr className="border-t border-border bg-secondary/20">
                        <td className="p-2 font-medium">Avg Power</td>
                        <td className="p-2 text-right font-mono">
                            {avgPower.zwift != null ? `${avgPower.zwift}` : '—'}
                        </td>
                        <td className="p-2 text-right font-mono">
                            {avgPower.strava != null ? `${avgPower.strava}` : '—'}
                        </td>
                        <td className="p-2 text-right font-mono">
                            {avgPower.diffW != null ? `${avgPower.diffW > 0 ? '+' : ''}${avgPower.diffW}` : '—'}
                        </td>
                        <td className="p-2 text-right">{diffBadge(avgPower.diffPct)}</td>
                    </tr>
                    {cpDiff.map(row => (
                        <tr key={row.key} className="border-t border-border/50 hover:bg-muted/20">
                            <td className="p-2 font-medium">{row.label}</td>
                            <td className="p-2 text-right font-mono">{row.zwift ?? '—'}</td>
                            <td className="p-2 text-right font-mono">{row.strava ?? '—'}</td>
                            <td className="p-2 text-right font-mono">
                                {row.diffW != null ? `${row.diffW > 0 ? '+' : ''}${row.diffW}` : '—'}
                            </td>
                            <td className="p-2 text-right">{diffBadge(row.diffPct)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2 px-1">
                Strava values computed from the synchronised race window
                {sync ? ` (${fmtOffset(sync.offsetSec)})` : ''}.
                Diff = Zwift − Strava.
            </p>
        </div>
    );
}

function CpCurveChart({ cpDiff }: { cpDiff: CpDiffRow[] }) {
    const chartData = cpDiff.map(r => ({
        label: r.label,
        Zwift: r.zwift,
        Strava: r.strava,
    }));
    return (
        <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barCategoryGap="25%" barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis
                        label={{ value: 'Watts', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                        tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    />
                    <Tooltip formatter={(v: number) => [`${v} W`]} />
                    <Legend verticalAlign="top" height={28} />
                    <Bar dataKey="Zwift"  fill="#FC6719" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Strava" fill="#FC4C02" fillOpacity={0.65} radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function StravaStreamChart({ result }: { result: DualRecordingResult }) {
    const { strava, sync } = result;
    if (!strava?.streams?.time?.length) return null;

    const { time: rawTime, watts, cadence, heartrate } = strava.streams;

    // Downsample to every 5 seconds for display performance
    const step = 5;
    const points = rawTime
        .filter((_, i) => i % step === 0)
        .map((t, idx) => ({
            t,
            timeLabel: new Date(t * 1000).toISOString().substr(11, 5),
            watts:    watts?.[idx * step] ?? null,
            cadence:  cadence?.[idx * step] ?? null,
            hr:       heartrate?.[idx * step] ?? null,
        }));

    const winStart = sync?.stravaWindowStart ?? null;
    const winEnd   = sync?.stravaWindowEnd   ?? null;

    return (
        <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']}
                        tickFormatter={t => new Date(t * 1000).toISOString().substr(11, 5)}
                        tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <YAxis yAxisId="w" orientation="left"
                        label={{ value: 'W', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                        tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <YAxis yAxisId="hr" orientation="right"
                        label={{ value: 'bpm / rpm', angle: 90, position: 'insideRight', style: { fontSize: 10 } }}
                        tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <Tooltip
                        labelFormatter={t => new Date(Number(t) * 1000).toISOString().substr(11, 8)}
                        formatter={(v: number, name: string) => [`${Math.round(v)}`, name]}
                    />
                    <Legend verticalAlign="top" height={28} />
                    {/* Highlight the synchronised race window */}
                    {winStart != null && winEnd != null && (
                        <ReferenceArea yAxisId="w" x1={winStart} x2={winEnd}
                            fill="#FC6719" fillOpacity={0.08} />
                    )}
                    {winStart != null && (
                        <ReferenceLine yAxisId="w" x={winStart}
                            stroke="#FC6719" strokeDasharray="4 2"
                            label={{ value: 'Race start', position: 'top', fontSize: 10, fill: '#FC6719' }} />
                    )}
                    {winEnd != null && (
                        <ReferenceLine yAxisId="w" x={winEnd}
                            stroke="#FC6719" strokeDasharray="4 2"
                            label={{ value: 'Race end', position: 'top', fontSize: 10, fill: '#FC6719' }} />
                    )}
                    <Line yAxisId="w" type="monotone" dataKey="watts"
                        stroke="#FC4C02" dot={false} strokeWidth={1.5} name="Power (W)" isAnimationActive={false} />
                    {heartrate?.length ? (
                        <Line yAxisId="hr" type="monotone" dataKey="hr"
                            stroke="#ef4444" dot={false} strokeWidth={1} strokeDasharray="4 2"
                            name="HR (bpm)" isAnimationActive={false} />
                    ) : null}
                    {cadence?.length ? (
                        <Line yAxisId="hr" type="monotone" dataKey="cadence"
                            stroke="#82ca9d" dot={false} strokeWidth={1} strokeDasharray="2 2"
                            name="Cadence (rpm)" isAnimationActive={false} />
                    ) : null}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
    riderId: string;
    zwiftActivities: ZwiftActivity[];
    stravaActivities: StravaMatchActivity[];
    loadingActivities: boolean;
    selectedZwiftId: string | null;
    setSelectedZwiftId: (id: string) => void;
    selectedStravaId: number | null;
    setSelectedStravaId: (id: number | null) => void;
    result: DualRecordingResult | null;
    loadingComparison: boolean;
    error: string;
    onLoadActivities: () => void;
    onCompare: (zwiftId: string, stravaId?: number | null) => void;
}

export default function DualRecordingPanel({
    riderId,
    zwiftActivities,
    stravaActivities,
    loadingActivities,
    selectedZwiftId,
    setSelectedZwiftId,
    selectedStravaId,
    setSelectedStravaId,
    result,
    loadingComparison,
    error,
    onLoadActivities,
    onCompare,
}: Props) {
    const loaded = useRef(false);
    const [manualZwiftId, setManualZwiftId] = useState('');

    // Auto-load activity lists when this panel first renders for a rider
    useEffect(() => {
        if (!loaded.current && riderId) {
            loaded.current = true;
            onLoadActivities();
        }
    }, [riderId, onLoadActivities]);

    // Reset loaded flag when rider changes
    useEffect(() => {
        loaded.current = false;
        setManualZwiftId('');
    }, [riderId]);

    // Manual ID takes precedence over the dropdown selection
    const effectiveZwiftId = manualZwiftId.trim() || selectedZwiftId;

    const handleCompare = () => {
        if (!effectiveZwiftId) return;
        onCompare(effectiveZwiftId, selectedStravaId);
    };

    return (
        <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
            {/* Header */}
            <div className="bg-[#FC6719]/10 p-4 border-b border-[#FC6719]/20 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-[#FC6719]">Dual Recording Verification</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Compare Zwift (primary) with Strava (secondary) for the same race.
                    </p>
                </div>
                <button
                    onClick={onLoadActivities}
                    disabled={loadingActivities}
                    className="text-xs px-3 py-1.5 rounded border border-[#FC6719]/40 text-[#FC6719] hover:bg-[#FC6719]/10 disabled:opacity-50"
                >
                    {loadingActivities ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            <div className="p-4 space-y-4">
                {/* Activity selectors */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Zwift */}
                    <div className="space-y-2">
                        <label className="block text-xs font-medium text-muted-foreground">
                            Zwift Activity (primary)
                        </label>
                        {loadingActivities ? (
                            <div className="h-9 bg-muted/40 rounded animate-pulse" />
                        ) : zwiftActivities.length > 0 ? (
                            <select
                                value={manualZwiftId ? '' : (selectedZwiftId ?? '')}
                                onChange={e => { setSelectedZwiftId(e.target.value); setManualZwiftId(''); }}
                                disabled={!!manualZwiftId}
                                className="w-full text-sm bg-background border border-input rounded px-2 py-1.5 text-foreground focus:ring-1 focus:ring-primary disabled:opacity-40"
                            >
                                <option value="">— select an activity —</option>
                                {zwiftActivities.map(a => (
                                    <option key={a.activityId} value={a.activityId ?? ''}>
                                        {a.name}
                                        {a.startedAt ? ` · ${new Date(a.startedAt).toLocaleDateString()}` : ''}
                                        {a.avgWatts ? ` · ${a.avgWatts}W` : ''}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <p className="text-xs text-muted-foreground italic">
                                No webhook-captured activities yet. Paste an activity ID below.
                            </p>
                        )}
                        {/* Manual fallback — always visible */}
                        <div>
                            <input
                                type="text"
                                placeholder="Or paste Zwift activity ID manually…"
                                value={manualZwiftId}
                                onChange={e => setManualZwiftId(e.target.value)}
                                className="w-full text-sm bg-background border border-input rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary font-mono"
                            />
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Find the ID in the race results or the Zwift activity URL.
                                Overrides the dropdown above.
                            </p>
                        </div>
                    </div>

                    {/* Strava */}
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                            Strava Activity (secondary) — auto-matched or override
                        </label>
                        {loadingActivities ? (
                            <div className="h-9 bg-muted/40 rounded animate-pulse" />
                        ) : stravaActivities.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic p-2">
                                No Strava activities found or Strava not connected.
                            </p>
                        ) : (
                            <select
                                value={selectedStravaId ?? ''}
                                onChange={e => setSelectedStravaId(e.target.value ? Number(e.target.value) : null)}
                                className="w-full text-sm bg-background border border-input rounded px-2 py-1.5 text-foreground focus:ring-1 focus:ring-primary"
                            >
                                <option value="">— auto-match by timestamp —</option>
                                {stravaActivities.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                        {a.startDateLocal ? ` · ${new Date(a.startDateLocal).toLocaleDateString()}` : ''}
                                        {a.averageWatts ? ` · ${a.averageWatts}W` : ''}
                                        {a.hasPowerMeter ? ' ⚡' : ''}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {/* Compare button */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleCompare}
                        disabled={!effectiveZwiftId || loadingComparison}
                        className="px-5 py-2 bg-[#FC6719] text-white rounded font-medium text-sm hover:opacity-90 disabled:opacity-40"
                    >
                        {loadingComparison ? 'Analysing…' : 'Compare'}
                    </button>
                    {result?.sync && (
                        <SyncBadge offsetSec={result.sync.offsetSec} />
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>
                )}

                {/* Warning (no Strava match) */}
                {result?.warning && !result.strava && (
                    <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded text-sm">
                        {result.warning}
                    </div>
                )}

                {/* Results */}
                {result && result.strava && result.comparison && (
                    <div className="space-y-6 pt-2">
                        {/* Activity metadata */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="bg-[#FC6719]/5 rounded p-3 border border-[#FC6719]/20">
                                <p className="font-semibold text-[#FC6719] mb-1">Zwift (primary)</p>
                                <p className="text-xs text-muted-foreground">{fmtDate(result.zwift.startedAt)}</p>
                                <p className="text-xs text-muted-foreground">{fmtDuration(result.zwift.durationSec)}</p>
                                {result.zwift.avgWatts && (
                                    <p className="text-xs font-mono mt-1">{result.zwift.avgWatts} W avg</p>
                                )}
                            </div>
                            <div className="bg-[#FC4C02]/5 rounded p-3 border border-[#FC4C02]/20">
                                <p className="font-semibold text-[#FC4C02] mb-1">{result.strava.name} (Strava)</p>
                                <p className="text-xs text-muted-foreground">{fmtDate(result.strava.startedAt)}</p>
                                <p className="text-xs text-muted-foreground">{fmtDuration(result.strava.durationSec)}</p>
                                {result.strava.avgWattsSynced && (
                                    <p className="text-xs font-mono mt-1">{result.strava.avgWattsSynced} W avg (race window)</p>
                                )}
                            </div>
                        </div>

                        {/* CP Curve comparison chart */}
                        <div>
                            <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                Power Curve Comparison
                            </h4>
                            <CpCurveChart cpDiff={result.comparison.cpDiff} />
                        </div>

                        {/* Stats table */}
                        <div>
                            <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                Difference Table
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    <span className="text-green-600">≤3%</span> good ·{' '}
                                    <span className="text-yellow-600">3–8%</span> acceptable ·{' '}
                                    <span className="text-red-600">&gt;8%</span> investigate
                                </span>
                            </h4>
                            <StatsTable result={result} />
                        </div>

                        {/* Strava stream chart */}
                        {result.strava.streams?.time?.length ? (
                            <div>
                                <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                    Strava Stream
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                        shaded area = synchronised race window
                                    </span>
                                </h4>
                                <StravaStreamChart result={result} />
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
