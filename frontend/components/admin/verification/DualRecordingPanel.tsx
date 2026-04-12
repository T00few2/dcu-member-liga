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
    if (sec === 0) return 'simultaneous start';
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    const label = m > 0 ? `${m}m ${s}s` : `${s}s`;
    return sec > 0
        ? `Strava started ${label} after Zwift`
        : `Strava started ${label} before Zwift`;
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

function SyncBadge({ sync }: { sync: NonNullable<DualRecordingResult['sync']> }) {
    return (
        <span className="text-xs text-muted-foreground italic">
            {fmtOffset(sync.stravaOffsetSec)}
            {' · '}
            <span className="font-mono">{sync.syncMethod === 'power_mse' ? 'power MSE sync' : 'timestamp sync'}</span>
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
                {sync ? ` · ${fmtOffset(sync.stravaOffsetSec)} · ${sync.syncMethod === 'power_mse' ? 'power MSE sync' : 'timestamp sync'}` : ''}.
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
    const { zwift, strava } = result;
    const step = 5;
    // Default: hide secondary series so the chart isn't overwhelming on first load
    const [hidden, setHidden] = useState<Set<string>>(
        () => new Set(['zwiftHR', 'stravaHR', 'zwiftCad', 'stravaCad', 'zwiftAlt', 'stravaAlt'])
    );

    const toggleSeries = (dataKey: string) =>
        setHidden((prev: Set<string>) => {
            const next = new Set(prev);
            if (next.has(dataKey)) next.delete(dataKey); else next.add(dataKey);
            return next;
        });

    const hasZwift = (zwift.streams?.time?.length ?? 0) > 0;
    const hasStrava = (strava?.streams?.time?.length ?? 0) > 0;
    if (!hasZwift && !hasStrava) return null;

    type StreamPoint = { w: number | null; hr: number | null; cad: number | null; alt: number | null };

    const zwiftByTime = new Map<number, StreamPoint>();
    if (hasZwift) {
        const { time, watts, heartrate, cadence, altitude } = zwift.streams!;
        time.forEach((t, i) => zwiftByTime.set(t, {
            w:   watts[i]     ?? null,
            hr:  heartrate[i] ?? null,
            cad: cadence[i]   ?? null,
            alt: altitude[i]  ?? null,
        }));
    }

    const stravaByTime = new Map<number, StreamPoint>();
    if (hasStrava) {
        const { time, watts, heartrate, cadence, altitude } = strava!.streams;
        time.forEach((t, i) => stravaByTime.set(t, {
            w:   watts[i]     ?? null,
            hr:  heartrate[i] ?? null,
            cad: cadence[i]   ?? null,
            alt: altitude[i]  ?? null,
        }));
    }

    const lookup = (m: Map<number, StreamPoint>, t: number) =>
        m.get(t) ?? m.get(t - 1) ?? m.get(t + 1);

    const zwiftTimes  = hasZwift  ? zwift.streams!.time : [];
    const stravaTimes = hasStrava ? strava!.streams.time : [];
    const allT = [...zwiftTimes, ...stravaTimes];
    const minT = Math.floor(Math.min(...allT) / step) * step;
    const maxT = Math.ceil(Math.max(...allT)  / step) * step;

    type ChartRow = {
        t: number;
        zwiftW: number | null; stravaW: number | null;
        zwiftHR: number | null; stravaHR: number | null;
        zwiftCad: number | null; stravaCad: number | null;
        zwiftAlt: number | null; stravaAlt: number | null;
    };
    const chartData: ChartRow[] = [];
    for (let t = minT; t <= maxT; t += step) {
        const zp = lookup(zwiftByTime, t);
        const sp = lookup(stravaByTime, t);
        chartData.push({
            t,
            zwiftW:    zp?.w   ?? null,
            stravaW:   sp?.w   ?? null,
            zwiftHR:   zp?.hr  ?? null,
            stravaHR:  sp?.hr  ?? null,
            zwiftCad:  zp?.cad ?? null,
            stravaCad: sp?.cad ?? null,
            zwiftAlt:  zp?.alt ?? null,
            stravaAlt: sp?.alt ?? null,
        });
    }

    const hasZwiftHR   = chartData.some(d => d.zwiftHR   !== null);
    const hasStravaHR  = chartData.some(d => d.stravaHR  !== null);
    const hasZwiftCad  = chartData.some(d => d.zwiftCad  !== null);
    const hasStravaCad = chartData.some(d => d.stravaCad !== null);
    const hasZwiftAlt  = chartData.some(d => d.zwiftAlt  !== null);
    const hasStravaAlt = chartData.some(d => d.stravaAlt !== null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleLegendClick = (e: any) => {
        const key = e?.dataKey != null ? String(e.dataKey) : null;
        if (key) toggleSeries(key);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legendFormatter = (value: string, entry: any) => {
        const key = entry?.dataKey != null ? String(entry.dataKey) : '';
        return (
            <span style={{
                cursor: 'pointer',
                opacity: hidden.has(key) ? 0.35 : 1,
                textDecoration: hidden.has(key) ? 'line-through' : 'none',
                userSelect: 'none',
            }}>
                {value}
            </span>
        );
    };

    return (
        <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 0, right: 50, bottom: 0, left: 0 }}>
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
                    <YAxis yAxisId="alt" orientation="right" width={40}
                        label={{ value: 'm', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 10 } }}
                        tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <Tooltip
                        labelFormatter={(t: number) => fmtRaceTime(Number(t))}
                        formatter={(v: unknown, name: string) =>
                            v != null ? [`${Math.round(v as number)}`, name] : ['—', name]}
                    />
                    <Legend
                        verticalAlign="top" height={36}
                        onClick={handleLegendClick}
                        formatter={legendFormatter}
                    />
                    <Brush
                        dataKey="t" height={22}
                        stroke="var(--border)" fill="var(--background)"
                        tickFormatter={fmtRaceTime}
                    />
                    {/* Power */}
                    {hasZwift && (
                        <Line yAxisId="w" type="monotone" dataKey="zwiftW"
                            stroke="#FC6719" dot={false} strokeWidth={2}
                            name="Zwift Power (W)" isAnimationActive={false} connectNulls={false}
                            hide={hidden.has('zwiftW')} />
                    )}
                    {hasStrava && (
                        <Line yAxisId="w" type="monotone" dataKey="stravaW"
                            stroke="#e05c00" dot={false} strokeWidth={1.5} strokeDasharray="5 3"
                            name="Strava Power (W)" isAnimationActive={false} connectNulls={false}
                            hide={hidden.has('stravaW')} />
                    )}
                    {/* Heart rate */}
                    {hasZwiftHR && (
                        <Line yAxisId="hr" type="monotone" dataKey="zwiftHR"
                            stroke="#ef4444" dot={false} strokeWidth={1.5}
                            name="Zwift HR (bpm)" isAnimationActive={false}
                            hide={hidden.has('zwiftHR')} />
                    )}
                    {hasStravaHR && (
                        <Line yAxisId="hr" type="monotone" dataKey="stravaHR"
                            stroke="#f87171" dot={false} strokeWidth={1} strokeDasharray="4 2"
                            name="Strava HR (bpm)" isAnimationActive={false}
                            hide={hidden.has('stravaHR')} />
                    )}
                    {/* Cadence */}
                    {hasZwiftCad && (
                        <Line yAxisId="hr" type="monotone" dataKey="zwiftCad"
                            stroke="#22c55e" dot={false} strokeWidth={1.5}
                            name="Zwift Cadence (rpm)" isAnimationActive={false}
                            hide={hidden.has('zwiftCad')} />
                    )}
                    {hasStravaCad && (
                        <Line yAxisId="hr" type="monotone" dataKey="stravaCad"
                            stroke="#86efac" dot={false} strokeWidth={1} strokeDasharray="4 2"
                            name="Strava Cadence (rpm)" isAnimationActive={false}
                            hide={hidden.has('stravaCad')} />
                    )}
                    {/* Elevation */}
                    {hasZwiftAlt && (
                        <Line yAxisId="alt" type="monotone" dataKey="zwiftAlt"
                            stroke="#6366f1" dot={false} strokeWidth={1.5}
                            name="Zwift Elevation (m)" isAnimationActive={false}
                            hide={hidden.has('zwiftAlt')} />
                    )}
                    {hasStravaAlt && (
                        <Line yAxisId="alt" type="monotone" dataKey="stravaAlt"
                            stroke="#a5b4fc" dot={false} strokeWidth={1} strokeDasharray="4 2"
                            name="Strava Elevation (m)" isAnimationActive={false}
                            hide={hidden.has('stravaAlt')} />
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
                        <SyncBadge sync={result.sync} />
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
                                        t=0 = Zwift recording start · Strava aligned by power MSE · click legend to toggle
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
