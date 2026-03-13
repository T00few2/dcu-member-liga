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

interface RouteSegment {
    from: number;
    to: number;
    type: 'sprint' | 'climb';
    name: string;
}

interface Props {
    worldName: string;
    routeName: string;
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

function compactSegmentLabel(name: string): string {
    const compact = name
        .replace(/\s+(reverse|rev\.?)$/i, ' Rev.')
        .replace(/\s+mountainside/i, ' Mtn.')
        .trim();
    const MAX_LEN = 20;
    return compact.length > MAX_LEN ? `${compact.slice(0, MAX_LEN - 1)}…` : compact;
}

function renderCenteredSegmentLabel(props: any, value: string, color: string) {
    const { viewBox } = props || {};
    if (!viewBox) return null;
    const cx = viewBox.x + viewBox.width / 2;
    const cy = viewBox.y + viewBox.height / 2;

    return (
        <text
            x={cx}
            y={cy}
            fill={color}
            fontSize={9}
            fontWeight={600}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(-90, ${cx}, ${cy})`}
            pointerEvents="none"
        >
            {value}
        </text>
    );
}

function ElevationTooltip({
    active, payload, label, routeSegments,
}: any) {
    if (!active || !payload?.length) return null;
    const pt: DataPoint = payload[0].payload;
    const dist = Number(label);
    const seg: RouteSegment | undefined = routeSegments?.find(
        (s: RouteSegment) => dist >= s.from && dist <= s.to,
    );
    const sign = pt.gradient > 0 ? '+' : '';
    return (
        <div className="rounded border bg-popover px-2 py-1 shadow text-xs space-y-0.5">
            <div className="font-medium">{dist.toFixed(1)} km</div>
            {seg && (
                <div style={{ color: SEGMENT_COLORS[seg.type], fontWeight: 600 }}>
                    {seg.name}
                </div>
            )}
            <div>{Math.round(pt.altitude)} m</div>
            <div style={{ color: gradientColor(pt.gradient) }}>
                {sign}{pt.gradient.toFixed(1)}%
            </div>
        </div>
    );
}

export default function RouteElevationChart({ worldName, routeName }: Props) {
    const [data, setData] = useState<DataPoint[] | null>(null);
    const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
    const [stravaSegmentUrl, setStravaSegmentUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams({ world: worldName, route: routeName });
        fetch(`/api/route-elevation?${params}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((json: {
                distance: number[];
                altitude: number[];
                segments?: RouteSegment[];
                stravaSegmentUrl?: string;
            } | null) => {
                setStravaSegmentUrl(json?.stravaSegmentUrl ?? null);
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
                    setRouteSegments(json.segments ?? []);
                }
            })
            .catch(() => {
                setStravaSegmentUrl(null);
            })
            .finally(() => setLoading(false));
    }, [worldName, routeName]);

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

    return (
        <div>
            {stravaSegmentUrl && (
                <div className="flex justify-end mb-1">
                    <a
                        href={stravaSegmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                        title="View route segment on Strava"
                    >
                        Strava ↗
                    </a>
                </div>
            )}
            <div style={{ width: '100%', height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 4, left: 0 }} baseValue="dataMin">
                        <defs>
                            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="100%">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
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
                                <ElevationTooltip {...props} routeSegments={routeSegments} />
                            )}
                            isAnimationActive={false}
                        />

                        {routeSegments.map((seg, i) => (
                            <ReferenceArea
                                key={i}
                                x1={seg.from}
                                x2={seg.to}
                                fill={SEGMENT_COLORS[seg.type]}
                                fillOpacity={0.25}
                                stroke={SEGMENT_COLORS[seg.type]}
                                strokeOpacity={0.6}
                                strokeWidth={1}
                                label={(labelProps) =>
                                    renderCenteredSegmentLabel(
                                        labelProps,
                                        compactSegmentLabel(seg.name),
                                        SEGMENT_COLORS[seg.type],
                                    )
                                }
                            />
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
