'use client';

import { useEffect, useRef, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, LineChart, Line, Brush,
} from 'recharts';
import type {
    ZwiftActivity, StravaMatchActivity, DualRecordingResult, CpDiffRow,
    EventActivityResult,
} from '@/hooks/useDualRecording';

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

function fmtRaceTime(sec: number) {
    const neg = sec < 0;
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function DualStreamChart({ result }: { result: DualRecordingResult }) {
    const { zwift, strava, sync } = result;
    const step = 5;
    const [hidden, setHidden] = useState<Set<string>>(new Set());

    const toggleSeries = (dataKey: string) =>
        setHidden(prev => {
            const next = new Set(prev);
            if (next.has(dataKey)) next.delete(dataKey); else next.add(dataKey);
            return next;
        });

    const hasZwift = (zwift.streams?.time?.length ?? 0) > 0;
    const hasStrava = (strava?.streams?.time?.length ?? 0) > 0;
    if (!hasZwift && !hasStrava) return null;

    // Align streams by wall-clock time using each activity's startedAt timestamp.
    // Each stream's `time` array is seconds-from-activity-start.
    // Converting both to epoch seconds puts them on the same absolute axis.
    // We anchor t=0 to whichever activity started later, so any pre-race
    // staging from the earlier recording appears at negative race-time.
    const zwiftEpochS  = zwift.startedAt  ? Date.parse(zwift.startedAt)  / 1000 : null;
    const stravaEpochS = strava?.startedAt ? Date.parse(strava.startedAt) / 1000 : null;

    // Shifts relative to the anchor (both ≤ 0; earlier start gets negative offset)
    let zwiftShift  = 0;
    let stravaShift = 0;
    if (zwiftEpochS !== null && stravaEpochS !== null) {
        const refEpochS = Math.max(zwiftEpochS, stravaEpochS);
        zwiftShift  = zwiftEpochS  - refEpochS;
        stravaShift = stravaEpochS - refEpochS;
    } else {
        // Fallback when timestamps are unavailable: use server-computed offset.
        // offsetSec = zwift_start − strava_start → shift Zwift by that amount.
        zwiftShift  = sync?.offsetSec ?? 0;
        stravaShift = 0;
    }

    type StreamPoint = { w: number | null; hr: number | null; cad: number | null };
    const zwiftMap = new Map<number, StreamPoint>();
    if (hasZwift) {
        const { time, watts, heartrate, cadence } = zwift.streams!;
        time.filter((_, i) => i % step === 0).forEach((t, i) => {
            const raceT = Math.round(t + zwiftShift);
            zwiftMap.set(raceT, {
                w:   watts[i * step]     ?? null,
                hr:  heartrate[i * step] ?? null,
                cad: cadence[i * step]   ?? null,
            });
        });
    }

    const stravaMap = new Map<number, StreamPoint>();
    if (hasStrava) {
        const { time, watts, heartrate, cadence } = strava!.streams;
        time.filter((_, i) => i % step === 0).forEach((t, i) => {
            const raceT = Math.round(t + stravaShift);
            stravaMap.set(raceT, {
                w:   watts[i * step]     ?? null,
                hr:  heartrate[i * step] ?? null,
                cad: cadence[i * step]   ?? null,
            });
        });
    }

    // Merge all race-time ticks and sort
    const allTimes = [...new Set([...zwiftMap.keys(), ...stravaMap.keys()])].sort((a, b) => a - b);
    const chartData = allTimes.map(t => ({
        t,
        zwiftW:  zwiftMap.get(t)?.w   ?? null,
        stravaW: stravaMap.get(t)?.w  ?? null,
        hr:      (zwiftMap.get(t)?.hr ?? stravaMap.get(t)?.hr) ?? null,
        cad:     (zwiftMap.get(t)?.cad ?? stravaMap.get(t)?.cad) ?? null,
    }));

    const hasHR  = chartData.some(d => d.hr  !== null);
    const hasCad = chartData.some(d => d.cad !== null);

    // Legend click handler — Recharts passes the legend item payload
    const handleLegendClick = (e: { dataKey?: string }) => {
        if (e.dataKey) toggleSeries(e.dataKey);
    };

    // Style legend labels to reflect hidden state
    const legendFormatter = (value: string, entry: { dataKey?: string }) => (
        <span style={{
            cursor: 'pointer',
            opacity: hidden.has(entry.dataKey ?? '') ? 0.35 : 1,
            textDecoration: hidden.has(entry.dataKey ?? '') ? 'line-through' : 'none',
            userSelect: 'none',
        }}>
            {value}
        </span>
    );

    return (
        <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']}
                        tickFormatter={fmtRaceTime}
                        tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <YAxis yAxisId="w" orientation="left"
                        label={{ value: 'W', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                        tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <YAxis yAxisId="hr" orientation="right"
                        label={{ value: 'bpm / rpm', angle: 90, position: 'insideRight', style: { fontSize: 10 } }}
                        tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <Tooltip
                        labelFormatter={(t: number) => fmtRaceTime(Number(t))}
                        formatter={(v: unknown, name: string) =>
                            v != null ? [`${Math.round(v as number)}`, name] : ['—', name]}
                    />
                    <Legend
                        verticalAlign="top" height={28}
                        onClick={handleLegendClick}
                        formatter={legendFormatter}
                    />
                    <Brush
                        dataKey="t" height={22}
                        stroke="var(--border)" fill="var(--background)"
                        tickFormatter={fmtRaceTime}
                    />
                    {hasZwift && (
                        <Line yAxisId="w" type="monotone" dataKey="zwiftW"
                            stroke="#FC6719" dot={false} strokeWidth={2}
                            name="Zwift Power (W)" isAnimationActive={false} connectNulls={false}
                            hide={hidden.has('zwiftW')} />
                    )}
                    {hasStrava && (
                        <Line yAxisId="w" type="monotone" dataKey="stravaW"
                            stroke="#FC4C02" dot={false} strokeWidth={1.5} strokeDasharray="5 3"
                            name="Strava Power (W)" isAnimationActive={false} connectNulls={false}
                            hide={hidden.has('stravaW')} />
                    )}
                    {hasHR && (
                        <Line yAxisId="hr" type="monotone" dataKey="hr"
                            stroke="#ef4444" dot={false} strokeWidth={1} strokeDasharray="3 3"
                            name="HR (bpm)" isAnimationActive={false}
                            hide={hidden.has('hr')} />
                    )}
                    {hasCad && (
                        <Line yAxisId="hr" type="monotone" dataKey="cad"
                            stroke="#82ca9d" dot={false} strokeWidth={1} strokeDasharray="2 2"
                            name="Cadence (rpm)" isAnimationActive={false}
                            hide={hidden.has('cad')} />
                    )}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─── Event lookup status badge ─────────────────────────────────────────────────

function EventLookupStatus({ res }: { res: EventActivityResult }) {
    if (!res.found) {
        return (
            <p className="text-sm text-red-600 mt-2">
                {res.message || 'Rider not found in this event.'}
            </p>
        );
    }
    const { subgroupLabel, riderResult, zwiftActivity } = res;
    return (
        <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded text-sm space-y-1">
            <p className="font-medium text-green-800">
                Found in {subgroupLabel || 'event'}
                {riderResult?.durationSec ? ` · ${fmtDuration(riderResult.durationSec)}` : ''}
                {riderResult?.avgWatts ? ` · ${riderResult.avgWatts} W avg` : ''}
            </p>
            {zwiftActivity ? (
                <p className="text-green-700 text-xs">
                    Zwift activity matched ({fmtDate(zwiftActivity.startedAt)}) — ready to compare.
                </p>
            ) : (
                <p className="text-amber-700 text-xs">
                    Zwift activity not in webhook store yet. Paste the activity ID manually below.
                </p>
            )}
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
    // Event-based lookup
    eventId: string;
    setEventId: (id: string) => void;
    loadingEventActivity: boolean;
    eventActivityResult: EventActivityResult | null;
    onLoadEventActivity: (eventId: string) => void;
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
    eventId,
    setEventId,
    loadingEventActivity,
    eventActivityResult,
    onLoadEventActivity,
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

    // Reset loaded flag and manual input when rider changes
    useEffect(() => {
        loaded.current = false;
        setManualZwiftId('');
    }, [riderId]);

    // Manual input overrides the dropdown / event-matched ID
    const effectiveZwiftId = manualZwiftId.trim()
        || (eventActivityResult?.zwiftActivity?.activityId ?? null)
        || selectedZwiftId;

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

            <div className="p-4 space-y-5">

                {/* ── Step 1: Event ID lookup (primary path) ───────────────── */}
                <div className="border border-border rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                        Step 1 — Look up by Zwift Event ID
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Paste the Zwift event ID from the race admin page. The system will find
                        this rider&apos;s result and auto-match the Strava activity.
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="e.g. 4567890"
                            value={eventId}
                            onChange={e => setEventId(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && onLoadEventActivity(eventId)}
                            className="flex-1 text-sm bg-background border border-input rounded px-3 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary font-mono"
                        />
                        <button
                            onClick={() => onLoadEventActivity(eventId)}
                            disabled={!eventId.trim() || loadingEventActivity}
                            className="px-4 py-1.5 bg-[#FC6719] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
                        >
                            {loadingEventActivity ? 'Looking up…' : 'Lookup'}
                        </button>
                    </div>
                    {eventActivityResult && (
                        <EventLookupStatus res={eventActivityResult} />
                    )}
                </div>

                {/* ── Step 2: Activity selectors (advanced / fallback) ─────── */}
                <div className="border border-border rounded-lg p-4 space-y-4">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                        Step 2 — Activity Selection
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Zwift */}
                        <div className="space-y-2">
                            <label className="block text-xs font-medium text-muted-foreground">
                                Zwift Activity (primary)
                            </label>
                            {/* Show event-resolved activity if available */}
                            {eventActivityResult?.found && eventActivityResult.zwiftActivity && !manualZwiftId && (
                                <div className="text-xs bg-green-50 border border-green-200 rounded px-2 py-1.5 font-mono text-green-800">
                                    {eventActivityResult.zwiftActivity.activityId}
                                    <span className="ml-2 text-green-600 font-sans">(from event lookup)</span>
                                </div>
                            )}
                            {/* Webhook dropdown — shown when no event result yet */}
                            {!eventActivityResult?.zwiftActivity && (
                                loadingActivities ? (
                                    <div className="h-9 bg-muted/40 rounded animate-pulse" />
                                ) : zwiftActivities.length > 0 ? (
                                    <select
                                        value={manualZwiftId ? '' : (selectedZwiftId ?? '')}
                                        onChange={e => { setSelectedZwiftId(e.target.value); setManualZwiftId(''); }}
                                        disabled={!!manualZwiftId}
                                        className="w-full text-sm bg-background border border-input rounded px-2 py-1.5 text-foreground focus:ring-1 focus:ring-primary disabled:opacity-40"
                                    >
                                        <option value="">— select from webhook history —</option>
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
                                        No webhook-captured activities. Use event lookup above or paste ID below.
                                    </p>
                                )
                            )}
                            {/* Always-visible manual override */}
                            <div>
                                <input
                                    type="text"
                                    placeholder="Or paste Zwift activity ID manually…"
                                    value={manualZwiftId}
                                    onChange={e => setManualZwiftId(e.target.value)}
                                    className="w-full text-sm bg-background border border-input rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary font-mono"
                                />
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Overrides event lookup and dropdown. Find the ID in the Zwift activity URL.
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

                        {/* Dual stream chart */}
                        {(result.zwift.streams?.time?.length || result.strava.streams?.time?.length) ? (
                            <div>
                                <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                    Recording Streams
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                        wall-clock aligned · t=0 is the later activity start
                                    </span>
                                </h4>
                                <DualStreamChart result={result} />
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
