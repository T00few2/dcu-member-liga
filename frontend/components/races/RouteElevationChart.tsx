'use client';

import { useEffect, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ReferenceArea,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { Sprint } from '@/types/live';

interface RouteSegment {
    from: number;
    to: number;
    type: 'sprint' | 'climb' | 'segment';
    name?: string;
    direction?: 'forward' | 'reverse';
}

interface ProfileSegment {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: number;
    toKm: number;
    direction?: 'forward' | 'reverse';
}

interface Props {
    worldName: string;
    routeName: string;
    laps?: number;
    pointSegments?: Sprint[];
}

interface DataPoint {
    distance: number; // km
    altitude: number; // m
    gradient: number; // %
}

const TARGET_POINTS = 400;
const SEGMENT_COLORS: Record<RouteSegment['type'], string> = {
    sprint: '#56A845',
    climb:  '#ed2324',
    segment: '#6b7280',
};

function getNiceStep(rawStep: number): number {
    if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
    const exponent = Math.floor(Math.log10(rawStep));
    const fraction = rawStep / 10 ** exponent;
    let niceFraction: number;

    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;

    return niceFraction * 10 ** exponent;
}

function gradientColor(pct: number): string {
    if (pct > 8)  return '#cc0000';
    if (pct > 5)  return '#ff4500';
    if (pct > 3)  return '#ff8c00';
    if (pct > 1)  return '#ffd700';
    if (pct > -1) return '#22aa55';
    if (pct > -3) return '#4da6ff';
    return '#0066cc';
}

function normalizeSegmentType(type: unknown): RouteSegment['type'] {
    return type === 'sprint' || type === 'climb' || type === 'segment' ? type : 'segment';
}

function getSegmentName(name: unknown): string {
    if (typeof name !== 'string') return 'Segment';
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : 'Segment';
}

function normalizeNameForMatch(name?: string): string {
    return getSegmentName(name)
        .toLowerCase()
        .replace(/\s+\(.*\)\s*$/g, '')
        .replace(/\s+(reverse|rev\.?)$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDirectionForMatch(direction?: string, name?: string): 'forward' | 'reverse' {
    if ((direction || '').toLowerCase() === 'reverse') return 'reverse';
    const n = getSegmentName(name).toLowerCase();
    if (n.includes('reverse') || n.includes(' rev')) return 'reverse';
    return 'forward';
}

function normalizeDirection(direction?: string): 'forward' | 'reverse' {
    return direction === 'reverse' ? 'reverse' : 'forward';
}

function compactSegmentLabel(name?: string, direction?: 'forward' | 'reverse'): string {
    const compact = getSegmentName(name)
        .replace(/\s+(reverse|rev\.?)$/i, ' Rev.')
        .replace(/\s+mountainside/i, ' Mtn.')
        .trim();
    const MAX_LEN = 20;
    return compact.length > MAX_LEN ? `${compact.slice(0, MAX_LEN - 1)}…` : compact;
}

function renderCenteredSegmentLabel(props: any, value: string, color: string, showPointIcon = false) {
    const { viewBox } = props || {};
    if (!viewBox) return null;
    const cx = viewBox.x + viewBox.width / 2;
    const cy = viewBox.y + viewBox.height / 2;

    return (
        <g pointerEvents="none">
            {showPointIcon && (
                <text
                    x={cx}
                    y={Math.max(2, viewBox.y - 14)}
                    fill="#d97706"
                    fontSize={10}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                >
                    ★
                </text>
            )}
            <text
                x={cx}
                y={cy}
                fill={color}
                fontSize={9}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(-90, ${cx}, ${cy})`}
            >
                {value}
            </text>
        </g>
    );
}

function ElevationTooltip({
    active, payload, label, routeSegments, pointSegmentOccurrenceKeys, routeOccurrenceKeys,
}: any) {
    if (!active || !payload?.length) return null;
    const pt: DataPoint = payload[0].payload;
    const dist = Number(label);
    const segIndex: number = routeSegments?.findIndex(
        (s: RouteSegment) => dist >= s.from && dist <= s.to,
    );
    const seg: RouteSegment | undefined = segIndex >= 0 ? routeSegments?.[segIndex] : undefined;
    const occKey = segIndex >= 0 ? routeOccurrenceKeys?.[segIndex] : '';
    const isPointSegment = !!seg && pointSegmentOccurrenceKeys?.has(occKey);
    const sign = pt.gradient > 0 ? '+' : '';
    return (
        <div className="rounded border bg-popover px-2 py-1 shadow text-xs space-y-0.5">
            <div className="font-medium">{dist.toFixed(1)} km</div>
            {seg && (
                <div style={{ color: SEGMENT_COLORS[normalizeSegmentType(seg.type)], fontWeight: 600 }}>
                    {compactSegmentLabel(seg.name, seg.direction)}
                </div>
            )}
            {isPointSegment && (
                <div style={{ color: '#d97706', fontWeight: 700 }}>Points segment</div>
            )}
            <div>{Math.round(pt.altitude)} m</div>
            <div style={{ color: gradientColor(pt.gradient) }}>
                {sign}{pt.gradient.toFixed(1)}%
            </div>
        </div>
    );
}

export default function RouteElevationChart({
    worldName,
    routeName,
    laps = 1,
    pointSegments = [],
}: Props) {
    const [data, setData] = useState<DataPoint[] | null>(null);
    const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams({ world: worldName, route: routeName, laps: String(laps) });
        fetch(`/api/route-elevation?${params}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((json: {
                distance: number[];
                altitude: number[];
                segments?: RouteSegment[];
                profileSegments?: ProfileSegment[];
            } | null) => {
                if (json?.distance?.length && json?.altitude?.length) {
                    const n = Math.max(1, Math.floor(json.distance.length / TARGET_POINTS));
                    const raw = json.distance
                        .filter((_, i) => i % n === 0)
                        .map((d, i) => ({
                            distance: d / 1_000,
                            altitude: json.altitude[i * n],
                        }));
                    const enriched: DataPoint[] = raw.map((pt, i) => ({
                        ...pt,
                        gradient:
                            i === 0
                                ? 0
                                : Math.round(
                                      ((pt.altitude - raw[i - 1].altitude) /
                                          ((pt.distance - raw[i - 1].distance) * 1_000)) *
                                          1_000
                                  ) / 10,
                    }));
                    setData(enriched);
                    const fromRouteProfile: RouteSegment[] = (json.profileSegments ?? [])
                        .map((seg): RouteSegment => {
                            const rawFrom = Number(seg.fromKm) || 0;
                            const rawTo = Number(seg.toKm) || 0;
                            return {
                                // Normalize bounds so segments always render even if entered in reverse order.
                                from: Math.min(rawFrom, rawTo),
                                to: Math.max(rawFrom, rawTo),
                                type: normalizeSegmentType(seg.type),
                                name: getSegmentName(seg.name),
                                direction: normalizeDirection(seg.direction),
                            };
                        })
                        .sort((a, b) => a.from - b.from || a.to - b.to);
                    if (fromRouteProfile.length > 0) {
                        setRouteSegments(fromRouteProfile);
                    } else {
                        setRouteSegments(
                            (json.segments ?? []).map((seg) => ({
                                from: Number.isFinite(seg?.from) ? seg.from : 0,
                                to: Number.isFinite(seg?.to) ? seg.to : 0,
                                type: normalizeSegmentType(seg?.type),
                                name: getSegmentName(seg?.name),
                                direction: normalizeDirection(seg?.direction),
                            })),
                        );
                    }
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [worldName, routeName, laps]);

    if (loading) {
        return (
            <div className="h-28 flex items-center justify-center text-muted-foreground text-xs">
                Henter ruteprofil…
            </div>
        );
    }

    if (!data) return null;

    const maxDist = data[data.length - 1]?.distance ?? 0;
    const distStep = getNiceStep(maxDist / 4);
    const maxDistTick = distStep * Math.ceil(maxDist / distStep);
    const xTicks = Array.from(
        { length: Math.max(2, Math.round(maxDistTick / distStep) + 1) },
        (_, i) => i * distStep,
    );

    const altitudes = data.map((d) => d.altitude);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const altRange = maxAlt - minAlt || 1;
    const altStep = Math.ceil(altRange / 4 / 10) * 10 || 10;
    const altBase = Math.floor(minAlt / altStep) * altStep;
    const yTicks = [0, 1, 2, 3, 4].map((i) => altBase + i * altStep);
    const pointSegmentOccurrenceKeys = new Set(
        (pointSegments || []).map((s) => {
            const base = normalizeNameForMatch(s.name);
            const dir = normalizeDirectionForMatch(s.direction, s.name);
            const occ = Number.isFinite(s.count) && s.count > 0 ? s.count : 1;
            return `${base}::${dir}::${occ}`;
        }),
    );
    const routeOccurrenceCounters = new Map<string, number>();
    const routeOccurrenceKeys = routeSegments.map((seg) => {
        const base = normalizeNameForMatch(seg.name);
        const dir = normalizeDirectionForMatch(seg.direction, seg.name);
        const keyBase = `${base}::${dir}`;
        const next = (routeOccurrenceCounters.get(keyBase) || 0) + 1;
        routeOccurrenceCounters.set(keyBase, next);
        return `${keyBase}::${next}`;
    });

    return (
        <div>
            <div style={{ width: '100%', height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 4, left: 0 }} baseValue="dataMin">
                        <defs>
                            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="100%">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                                <stop offset="65%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                                <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.2} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeOpacity={0.15} />
                        <XAxis
                            dataKey="distance"
                            type="number"
                            domain={[0, maxDistTick]}
                            ticks={xTicks}
                            tickFormatter={(v, i) => i === xTicks.length - 1 ? `${v.toFixed(0)} km` : `${v.toFixed(0)}`}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            type="number"
                            domain={[altBase, altBase + altStep * 4]}
                            ticks={yTicks}
                            tickFormatter={(v, i) => i === 0 ? `${v} m` : `${v}`}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            width={30}
                        />
                        <Tooltip
                            content={(props) => (
                                <ElevationTooltip
                                    {...props}
                                    routeSegments={routeSegments}
                                    pointSegmentOccurrenceKeys={pointSegmentOccurrenceKeys}
                                    routeOccurrenceKeys={routeOccurrenceKeys}
                                />
                            )}
                            isAnimationActive={false}
                        />

                        {routeSegments.map((seg, i) => (
                            (() => {
                                const isPointSegment = pointSegmentOccurrenceKeys.has(routeOccurrenceKeys[i]);
                                const segmentBoxTop = altBase + altStep * 3.7;
                                return (
                            <ReferenceArea
                                key={i}
                                x1={seg.from}
                                x2={seg.to}
                                y1={altBase}
                                y2={segmentBoxTop}
                                fill={SEGMENT_COLORS[normalizeSegmentType(seg.type)]}
                                fillOpacity={0.25}
                                stroke={SEGMENT_COLORS[normalizeSegmentType(seg.type)]}
                                strokeOpacity={0.6}
                                strokeWidth={1}
                                label={(labelProps) =>
                                    renderCenteredSegmentLabel(
                                        labelProps,
                                        compactSegmentLabel(seg.name, seg.direction),
                                        SEGMENT_COLORS[normalizeSegmentType(seg.type)],
                                        isPointSegment,
                                    )
                                }
                            />
                                );
                            })()
                        ))}

                        <Area
                            type="monotone"
                            dataKey="altitude"
                            stroke="hsl(var(--primary))"
                            strokeWidth={1.5}
                            fill="url(#elevGrad)"
                            dot={false}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
